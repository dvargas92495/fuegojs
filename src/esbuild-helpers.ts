import { build, BuildInvalidate, BuildOptions } from "esbuild";
import chokidar from "chokidar";
import isr from "./isr";
import {
  appPath,
  getDotEnvObject,
  INTERMEDIATE_DIR,
  promiseRimraf,
} from "./common";
import fs from "fs";
import path from "path";

const API_INPUT_DIR = "functions";
const API_OUTPUT_DIR = "build";
const API_DYNAMIC_ENV_FILE = "_env.ts";

export const outputHtmlFile = (
  page: string,
  params: Record<string, string> = {}
): Promise<number> => {
  const pagePath = page
    .replace(/^pages[/\\]/, "")
    .replace(/\.[t|j]sx?$/, ".js")
    .replace(/\\/g, "/");
  const dataPath = page.replace(/\.([t|j])sx?$/, ".data.$1s");
  const entryPoints = [page, "pages/_html.tsx", dataPath];
  return build({
    entryPoints: entryPoints.filter((p) => fs.existsSync(p)),
    platform: "node",
    define: getDotEnvObject(),
    outdir: INTERMEDIATE_DIR,
    bundle: true,
    external: ["react", "react-dom"],
  })
    .then(() =>
      Promise.all(
        entryPoints
          .map((p) =>
            p
              .replace(/^pages[/\\]/, `${INTERMEDIATE_DIR}/`)
              .replace(/\.[t|j]sx?$/, ".js")
          )
          .map((p) =>
            fs.existsSync(p) ? import(appPath(p)) : Promise.resolve({})
          )
      )
    )
    .then(([Page, _html, data]) =>
      isr({ Page, _html, data, params, path: pagePath })
    )
    .catch((e) => {
      console.error(e.message);
      return 1;
    });
};

const COMMON_REGEX = /^pages[/\\]_/;
export const outputHtmlFiles = (
  entryPoints: { entry: string; params: Record<string, string> }[]
): Promise<number> =>
  Promise.all(
    entryPoints
      .filter((t) => !COMMON_REGEX.test(t.entry))
      .map((s) => outputHtmlFile(s.entry, s.params))
  ).then((codes) => (codes.some((c) => c > 0) ? 1 : 0));

export const esbuildWatch = ({
  paths,
  opts,
  entryRegex,
  rebuildCallback,
  mapFile = (s) => s,
}: {
  paths: string[];
  opts: Partial<BuildOptions>;
  entryRegex: RegExp;
  rebuildCallback: (s: string) => Promise<void | number>;
  mapFile?: (s: string) => string;
}): void => {
  const rebuilders: Record<string, BuildInvalidate> = {};
  const dependencies: Record<string, Set<string>> = {};
  chokidar
    .watch(paths)
    .on("add", (file) => {
      const { outdir = "", ...restOpts } = opts;
      if (entryRegex.test(file)) {
        console.log(`building ${file}...`);
        build({
          ...restOpts,
          entryPoints: [mapFile(file)],
          outfile: path.join(
            outdir,
            file
              .replace(new RegExp(`^(${paths.join("|")})[/\\\\]`), "")
              .replace(/\.tsx?$/, ".js")
          ),
          incremental: true,
          plugins: [
            ...(opts.plugins || []),
            {
              name: "dependency-watch",
              setup: (build) => {
                build.onLoad({ filter: /^.*$/s }, async (args) => {
                  const dep = path.relative(process.cwd(), args.path);
                  dependencies[dep] = dependencies[dep] || new Set();
                  if (!dependencies[dep].has(file)) {
                    dependencies[dep].add(file);
                  }
                  return undefined;
                });
              },
            },
          ],
        })
          .then((r) => {
            rebuilders[file] = r.rebuild;
            return rebuildCallback(file);
          })
          .then(() => console.log(`successfully built ${file}...`));
      }
    })
    .on("change", (file) => {
      console.log(`File ${file} has been changed`);
      const entries = dependencies[file] || [];
      entries.forEach((entry) => {
        rebuilders[entry]()
          .then(() => rebuildCallback(entry))
          .then(() => console.log(`Rebuilt ${entry}`));
      });
    })
    .on("unlink", (file) => {
      console.log(`File ${file} has been removed`);
      delete dependencies[file];
      if (entryRegex.test(file)) {
        Object.values(dependencies).forEach((deps) => deps.delete(file));
        rebuilders[file].dispose();
        delete rebuilders[file];
      }
    });
};

export const prepareApiBuild = (): Promise<Partial<BuildOptions>> =>
  promiseRimraf(API_OUTPUT_DIR).then(async () => {
    const baseOpts = {
      bundle: true,
      outdir: appPath(API_OUTPUT_DIR),
      platform: "node" as const,
      external: ["aws-sdk", "canvas"],
      define: getDotEnvObject(),
    };
    const dynamicEnv = fs.existsSync(
      appPath(`${API_INPUT_DIR}/${API_DYNAMIC_ENV_FILE}`)
    )
      ? await build({
          ...baseOpts,
          entryPoints: [appPath(`${API_INPUT_DIR}/${API_DYNAMIC_ENV_FILE}`)],
        })
          .then(
            () =>
              import(
                appPath(
                  `${API_OUTPUT_DIR}/${API_DYNAMIC_ENV_FILE.replace(
                    /\.ts/,
                    ".js"
                  )}`
                )
              )
          )
          .then((mod) => mod.default())
          .then((env) => {
            if (typeof env !== "object") {
              console.warn(
                "Incorrect type detected for dynamic env. Expected object, received",
                typeof env
              );
              return {};
            }
            const invalidEntry = Object.entries(env).find(
              ([v]) => typeof v !== "string"
            );
            if (invalidEntry) {
              console.warn(
                `Incorrect type detected for dynamic env for field ${invalidEntry[0]}. Expected string, received`,
                typeof invalidEntry[1]
              );
              return {};
            }
            return env as Record<string, string>;
          })
      : {};
    return {
      ...baseOpts,
      define: {
        ...baseOpts.define,
        ...dynamicEnv,
      },
    };
  });

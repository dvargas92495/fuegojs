import { build, BuildInvalidate, BuildOptions } from "esbuild";
import chokidar from "chokidar";
import {
  appPath,
  getDotEnvObject,
  getFuegoConfig,
  promiseRimraf,
} from "./common";
import fs from "fs";
import path from "path";

const API_INPUT_DIR = "functions";
const API_OUTPUT_DIR = "build";
const API_DYNAMIC_ENV_FILE = "_env.ts";

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
          .then(() => console.log(`Rebuilt ${entry}`))
          .catch((e) => console.error(`Failed to rebuild`, entry, e));
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
      target: "node14",
    };
    const { functionFileDependencies = null } = getFuegoConfig();
    if (
      typeof functionFileDependencies === "object" &&
      functionFileDependencies
    ) {
      const filesToCopy = Object.values(functionFileDependencies)
        .filter((files) => !!files)
        .flatMap((files) =>
          typeof files === "string"
            ? [{ from: files, to: path.basename(files) }]
            : typeof files === "object"
            ? Object.values(files)
                .map((f) =>
                  typeof f === "string"
                    ? { from: f, to: path.basename(f) }
                    : typeof f === "object" && f
                    ? { from: (f as string[])[0], to: (f as string[])[1] }
                    : undefined
                )
                .filter((f) => !!f)
            : []
        ) as { from: string; to: string }[];
      if (filesToCopy.length) {
        fs.mkdirSync(appPath(API_OUTPUT_DIR), { recursive: true });
        Array.from(new Set(filesToCopy)).forEach(({ from, to }) => {
          const out = path.join(appPath(API_OUTPUT_DIR), to);
          if (!fs.existsSync(path.dirname(out)))
            fs.mkdirSync(path.dirname(out), { recursive: true });
          try {
            fs.copyFileSync(from, out);
          } catch (e) {
            console.error(`Failed to copy file from ${from} to ${out}`);
            console.error(e);
          }
        });
      }
    }
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
            return Object.fromEntries(
              Object.entries(env).map(([k, v]) => [
                `process.env.${k}`,
                `"${v}"`,
              ])
            );
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

import { build, BuildInvalidate, BuildOptions } from "esbuild";
import chokidar from "chokidar";
import isr from "./isr";
import { appPath, getDotEnvObject, INTERMEDIATE_DIR } from "./common";
import fs from "fs";
import path from "path";

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
                const entry = (build.initialOptions.entryPoints as string[])[0];
                build.onLoad({ filter: /^.*$/s }, async (args) => {
                  const dep = path.relative(process.cwd(), args.path);
                  dependencies[dep] = dependencies[dep] || new Set();
                  if (!dependencies[dep].has(entry)) {
                    dependencies[dep].add(entry);
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

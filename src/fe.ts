import { appPath, feBuildOpts, outputHtmlFile, prepareFeBuild } from "./common";
import esbuild, { BuildInvalidate } from "esbuild";
import express from "express";
import chokidar from "chokidar";

const rebuilders: Record<string, BuildInvalidate> = {};
const dependencies: Record<string, Set<string>> = {};

const fe = (): Promise<number> =>
  prepareFeBuild().then(() => {
    chokidar
      .watch(["pages", "src"])
      .on("add", (file) => {
        console.log(`File ${file} has been added`);
        if (file.startsWith("pages")) {
          esbuild
            .build({
              ...feBuildOpts,
              entryPoints: [file],
              incremental: true,
              plugins: [
                {
                  name: "dependency-watch",
                  setup: (build) => {
                    build.onLoad({ filter: /^.*$/s }, async (args) => {
                      dependencies[args.path] =
                        dependencies[args.path] || new Set();
                      dependencies[args.path].add(
                        (build.initialOptions.entryPoints as string[])[0]
                      );
                      return undefined;
                    });
                  },
                },
              ],
            })
            .then((r) => {
              rebuilders[file] = r.rebuild;
              return outputHtmlFile(file);
            });
        }
      })
      .on("change", (file) => {
        console.log(`File ${file} has been changed`);
        const entries = dependencies[file];
        entries.forEach((entry) => {
          console.log(`Rebuilding ${entry}`);
          rebuilders[entry]();
        });
      })
      .on("unlink", (file) => {
        console.log(`File ${file} has been removed`);
        delete dependencies[file];
        if (file.startsWith("pages")) {
          Object.values(dependencies).forEach((deps) => deps.delete(file));
          rebuilders[file].dispose();
          delete rebuilders[file];
        }
      });
    const app = express();
    app.use(express.static(appPath("out")));
    return new Promise((resolve) => {
      app.listen(3000, () => {
        console.log("Web server listening on port 3000...");
      });
      app.on("close", () => resolve(0));
    });
  });

export default fe;

import { appPath, feBuildOpts, outputHtmlFile, prepareFeBuild } from "./common";
import esbuild, { BuildInvalidate } from "esbuild";
import express from "express";
import chokidar from "chokidar";
import path from "path";

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
                    const entry = (
                      build.initialOptions.entryPoints as string[]
                    )[0];
                    build.onLoad({ filter: /^.*$/s }, async (args) => {
                      const dep = path.relative(process.cwd(), args.path);
                      dependencies[dep] = dependencies[dep] || new Set();
                      dependencies[dep].add(entry);
                      console.log("Added dependency on", dep, "for", entry);
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
        const entries = dependencies[file] || [];
        entries.forEach((entry) => {
          console.log(`Rebuilding ${entry}`);
          rebuilders[entry]().then(() => outputHtmlFile(entry));
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
    app.use(express.static(appPath("out"), { extensions: ["html"] }));
    return new Promise((resolve) => {
      app.listen(3000, () => {
        console.log("Web server listening on port 3000...");
      });
      process.on("exit", () => {
        console.log("Closing...");
        resolve(0);
      });
    });
  });

export default fe;

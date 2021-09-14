import { appPath, feBuildOpts, outputHtmlFile, prepareFeBuild } from "./common";
import esbuild, { BuildInvalidate } from "esbuild";
import express from "express";
import chokidar from "chokidar";

const rebuilders: Record<string, BuildInvalidate> = {};

const fe = (): Promise<number> =>
  prepareFeBuild().then(() => {
    chokidar
      .watch([appPath("pages"), appPath("src")])
      .on("add", (path) => {
        console.log(`File ${path} has been added`);
        esbuild
          .build({
            ...feBuildOpts,
            entryPoints: [path],
            incremental: true,
            plugins: [
              {
                name: "dependency-watch",
                setup: (build) => {
                  build.onLoad({ filter: /^.*$/s }, async (args) => {
                    console.log("deps", args, build.initialOptions.entryPoints);
                    return undefined;
                  });
                },
              },
            ],
          })
          .then((r) => {
            rebuilders[path] = r.rebuild;
            return outputHtmlFile(path);
          });
      })
      .on("change", (path) => {
        console.log(`File ${path} has been changed`);
        rebuilders[path]();
      })
      .on("unlink", (path) => {
        console.log(`File ${path} has been removed`);
        rebuilders[path].dispose();
        delete rebuilders[path];
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

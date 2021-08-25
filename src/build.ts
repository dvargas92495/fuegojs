import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import childProcess from "child_process";
import rimraf from "rimraf";
import { appPath, readDir } from "./common";

const promiseRimraf = (s: string) =>
  new Promise((resolve) => rimraf(s, resolve));

const HTML_REGEX = /_html\.js$/;

const buildDir = (dir: string): Promise<number[]> => {
  const entryPoints = readDir(dir);
  return esbuild
    .build({
      entryPoints,
      target: "node12",
      platform: "node",
      bundle: true,
      outdir: "_fuego",
      external: ["react", "react-dom"],
    })
    .then((result) => {
      if (result.errors.length) {
        throw new Error(JSON.stringify(result.errors));
      }
      return Promise.all(
        entryPoints
          .filter((t) => !HTML_REGEX.test(t))
          .map((file) =>
            new Promise<number>((resolve, reject) => {
              const page = file
                .replace(/^pages\//, "")
                .replace(/\.tsx$/, ".js")
                .replace(/\\/g, "/");
              const ls = childProcess.spawn("node", [
                path.join("_fuego", "_html.js").replace(/\\/g, "/"),
                page,
              ]);
              let loggedErrors = false;
              ls.stdout.on("data", (data) => {
                console.log(`Log from building ${page}: ${data}`);
              });

              ls.stderr.on("data", (data) => {
                console.error(`Error building ${page}: ${data}`);
                loggedErrors = true;
              });

              ls.on("close", (code) => {
                code || loggedErrors
                  ? reject(new Error(`Failed to build ${page}`))
                  : resolve(0);
              });
            }).catch((e) => {
              console.error(e.message);
              return 1;
            })
          )
      );
    });
};

const build = (): Promise<number> =>
  Promise.all([promiseRimraf("_fuego"), promiseRimraf("out")])
    .then(() => {
      fs.mkdirSync("_fuego");
      fs.mkdirSync("out");
      return new Promise((resolve, reject) =>
        fs
          .createReadStream(appPath("node_modules/fuegojs/dist/_html.js"))
          .pipe(fs.createWriteStream(path.join("_fuego", "_html.js")))
          .once("error", reject)
          .once("finish", resolve)
      );
    })
    .then(() => buildDir("pages"))
    .then((codes) => {
      return promiseRimraf("_fuego").then(() => {
        console.log("Finished!");
        return codes.some((c) => c > 0) ? 1 : 0;
      });
    })
    .catch((e) => {
      return promiseRimraf("_fuego").then(() => {
        console.error("ERROR:", e.message);
        return 1;
      });
    });

export default build;

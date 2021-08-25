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
      outdir: "/tmp",
      external: ["react", "react-dom"],
    })
    .then((result) => {
      if (result.errors.length) {
        throw new Error(JSON.stringify(result.errors));
      }
      console.log("result", JSON.stringify(result));
      return Promise.all(
        entryPoints
          .filter((t) => !HTML_REGEX.test(t))
          .map((file) =>
            new Promise<number>((resolve) => {
              const ls = childProcess.spawn("node", [
                path.join("/tmp", "_html.js").replace(/\\/g, "/"),
                file.replace(/^pages/, ""),
                file.replace(/\.tsx/, ".js").replace(/\\/g, "/"),
              ]);
              let loggedErrors = false;
              ls.stdout.on("data", (data) => {
                console.log(`stdout: ${data}`);
              });

              ls.stderr.on("data", (data) => {
                console.error(`stderr: ${data}`);
                loggedErrors = true;
              });

              ls.on("close", (code) => {
                code || loggedErrors ? process.exit(code || 1) : resolve(0);
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
  Promise.all([promiseRimraf("/tmp"), promiseRimraf("out")])
    .then(() => {
      fs.mkdirSync("/tmp");
      fs.mkdirSync("out");
      return new Promise((resolve, reject) =>
        fs
          .createReadStream(appPath("node_modules/fuegojs/dist/_html.js"))
          .pipe(fs.createWriteStream(path.join("/tmp", "html.js")))
          .once("error", reject)
          .once("finish", resolve)
      );
    })
    .then(() => buildDir(appPath("pages")))
    .then((codes) => {
      promiseRimraf("/tmp");
      console.log("Finished!");
      return codes.some((c) => c > 0) ? 1 : 0;
    });

export default build;

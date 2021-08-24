import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import childProcess from "child_process";
import rimraf from "rimraf";
import { appPath, readDir } from "./common";

const promiseRimraf = (s: string) =>
  new Promise((resolve) => rimraf(s, resolve));

const buildDir = (dir: string): Promise<number[]> =>
  esbuild
    .build({
      entryPoints: [appPath("pages/_html.tsx")],
      bundle: true,
      target: "node12",
      platform: "node",
      outfile: path.join("tmp", "_html.js"),
      external: ["react", "react-dom"],
    })
    .then(() => fs.mkdirSync("out"))
    .then(() =>
      Promise.all(
        readDir(dir)
          .filter((name) => !/_html\.tsx$/.test(name))
          .map((file) =>
            esbuild
              .build({
                entryPoints: [appPath(path.join(dir, file))],
                target: "node12",
                platform: "node",
                bundle: true,
                outfile: path.join(
                  "tmp",
                  dir.replace(/^pages/, ""),
                  file.replace(/\.tsx/, ".js")
                ),
                external: ["react", "react-dom"],
              })
              .then((result) => {
                if (result.errors.length) {
                  throw new Error(JSON.stringify(result.errors));
                }
                const ls = childProcess.spawn("node", [
                  path.join("tmp", "_html.js").replace(/\\/g, "/"),
                  path
                    .join(
                      dir.replace(/^pages/, ""),
                      file.replace(/\.tsx/, ".js")
                    )
                    .replace(/\\/g, "/"),
                ]);
                return new Promise<number>((resolve) => {
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
                });
              })
              .catch(() => {
                return 0;
              })
          )
      )
    );

const build = (): Promise<number> =>
  Promise.all([promiseRimraf("tmp"), promiseRimraf("out")])
    .then(() => {
      fs.mkdirSync("tmp");
      return buildDir("pages");
    })
    .then((codes) => {
        promiseRimraf("tmp");
        console.log("Finished!");
        return codes.some(c => c > 0) ? 1 : 0;
    });

export default build;

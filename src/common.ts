import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import childProcess from "child_process";

export const INTERMEDIATE_DIR = "_fuego";

export const appPath = (p: string): string =>
  path.resolve(fs.realpathSync(process.cwd()), p);

export const readDir = (s: string): string[] =>
  fs
    .readdirSync(s, { withFileTypes: true })
    .flatMap((f) =>
      f.isDirectory() ? readDir(`${s}/${f.name}`) : [`${s}/${f.name}`]
    );

export const feBuildOpts = {
  platform: "node" as const,
  bundle: true,
  outdir: INTERMEDIATE_DIR,
  external: ["react", "react-dom"],
};

export const promiseRimraf = (s: string): Promise<null | void | Error> =>
  new Promise((resolve) => rimraf(s, resolve));

export const prepareFeBuild = (): Promise<void> =>
  Promise.all([promiseRimraf(INTERMEDIATE_DIR), promiseRimraf("out")]).then(
    () => {
      fs.mkdirSync(INTERMEDIATE_DIR);
      fs.mkdirSync("out");
      return new Promise((resolve, reject) =>
        fs
          .createReadStream(appPath("node_modules/fuegojs/dist/_html.js"))
          .pipe(fs.createWriteStream(path.join(INTERMEDIATE_DIR, "_html.js")))
          .once("error", reject)
          .once("finish", resolve)
      );
    }
  );

export const outputHtmlFile = (page: string): Promise<number> =>
  new Promise<number>((resolve, reject) => {
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
  });

const HTML_REGEX = /_html\.js$/;
export const outputHtmlFiles = (entryPoints: string[]): Promise<number> =>
  Promise.all(
    entryPoints.filter((t) => !HTML_REGEX.test(t)).map(outputHtmlFile)
  ).then((codes) => (codes.some((c) => c > 0) ? 1 : 0));

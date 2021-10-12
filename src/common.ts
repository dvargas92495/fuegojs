import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import childProcess from "child_process";
import dotenv from "dotenv";
import type { Express } from "express";
import { build, BuildInvalidate, BuildOptions } from "esbuild";
import chokidar from "chokidar";
import esbuildPluginTsc from "esbuild-plugin-tsc";
dotenv.config();

export const INTERMEDIATE_DIR = "_fuego";

export const appPath = (p: string): string =>
  path.resolve(fs.realpathSync(process.cwd()), p);

export const readDir = (s: string): string[] =>
  fs
    .readdirSync(s, { withFileTypes: true })
    .flatMap((f) =>
      f.isDirectory() ? readDir(`${s}/${f.name}`) : [`${s}/${f.name}`]
    );

const IGNORE_ENV = ["HOME"];
export const getDotEnvObject = (): Record<string, string> => {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => !/[()]/.test(k))
        .filter(([k]) => !IGNORE_ENV.includes(k))
    ),
  };
  return Object.fromEntries(
    Object.keys(env).map((k) => [`process.env.${k}`, JSON.stringify(env[k])])
  );
};

export const feBuildOpts = {
  platform: "node" as const,
  bundle: true,
  outdir: INTERMEDIATE_DIR,
  external: ["react", "react-dom"],
  define: getDotEnvObject(),
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

export const prepareApiBuild = (): Promise<Partial<BuildOptions>> =>
  promiseRimraf("build").then(() => {
    return {
      bundle: true,
      outdir: appPath("build"),
      platform: "node",
      external: ["aws-sdk", "canvas"],
      define: getDotEnvObject(),
      plugins: [esbuildPluginTsc()],
    };
  });

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

export const setupServer = ({
  app,
  port,
  label,
}: {
  app: Express;
  port: number;
  label: string;
}): Promise<number> =>
  new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`${label} server listening on port ${port}...`);
    });
    process.on("exit", () => {
      console.log("Closing...");
      resolve(0);
    });
  });

export const esbuildWatch = ({
  paths,
  opts,
  entryRegex,
  rebuildCallback,
}: {
  paths: string[];
  opts: Partial<BuildOptions>;
  entryRegex: RegExp;
  rebuildCallback: (s: string) => Promise<void | number>;
}): void => {
  const rebuilders: Record<string, BuildInvalidate> = {};
  const dependencies: Record<string, Set<string>> = {};
  chokidar
    .watch(paths)
    .on("add", (file) => {
      console.log(`File ${file} has been added`);
      if (entryRegex.test(file)) {
        build({
          ...opts,
          entryPoints: [file],
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
                    if (!/node_modules/.test(file))
                      console.log("Added dependency on", dep, "for", entry);
                  }
                  return undefined;
                });
              },
            },
          ],
        }).then((r) => {
          rebuilders[file] = r.rebuild;
          return rebuildCallback(file);
        });
      }
    })
    .on("change", (file) => {
      console.log(`File ${file} has been changed`);
      const entries = dependencies[file] || [];
      entries.forEach((entry) => {
        console.log(`Rebuilding ${entry}`);
        rebuilders[entry]().then(() => rebuildCallback(entry));
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

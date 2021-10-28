import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import dotenv from "dotenv";
import type { Express } from "express";
import { build, BuildInvalidate, BuildOptions } from "esbuild";
import chokidar from "chokidar";
import React from "react";
import ReactDOMServer from "react-dom/server";
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
  bundle: true,
  outdir: INTERMEDIATE_DIR,
  define: getDotEnvObject(),
};

export const promiseRimraf = (s: string): Promise<null | void | Error> =>
  new Promise((resolve) => rimraf(s, resolve));

export const prepareFeBuild = (): Promise<void> =>
  Promise.all([promiseRimraf(INTERMEDIATE_DIR), promiseRimraf("out")]).then(
    () => {
      fs.mkdirSync(INTERMEDIATE_DIR);
      fs.mkdirSync("out");
      return Promise.resolve(); /*new Promise((resolve, reject) =>
        fs
          .createReadStream(appPath("node_modules/fuegojs/dist/_html.fuego.js"))
          .pipe(
            fs.createWriteStream(path.join(INTERMEDIATE_DIR, "_html.fuego.js"))
          )
          .once("error", reject)
          .once("finish", resolve)
      );*/
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
    };
  });

export const outputHtmlFile = (
  page: string,
  params: Record<string, string> = {}
): Promise<number> => {
  const pagePath = page
    .replace(/^pages[/\\]/, "")
    .replace(/\.tsx$/, ".js")
    .replace(/\\/g, "/");
  const serverPath = pagePath.replace(/\.js$/, ".server.js");
  const dataPath = pagePath.replace(/\.js$/, ".data.js");

  return Promise.all(
    [serverPath, "_html.js", dataPath].map((p) =>
      fs.existsSync(`${INTERMEDIATE_DIR}/${p}`)
        ? import(appPath(`${INTERMEDIATE_DIR}/${p}`))
        : Promise.resolve({})
    )
  )
    .then(async ([r, _html, data]) => {
      const Page = r.default;
      const Head = (r.Head as React.FC) || React.Fragment;
      const ReactRoot =
        (_html.default as React.FC) ||
        (({ children }) => React.createElement("div", {}, children));
      const getStaticProps =
        (data.default as (p: {
          params: Record<string, string>;
        }) => Promise<{ props: Record<string, unknown> }>) ||
        (() => Promise.resolve({ props: {} }));
      const parameterizedPath = pagePath.replace(
        /\[([a-z0-9-]+)\]/g,
        (_, param) => params[param]
      );
      const outfile = path.join(
        "out",
        parameterizedPath.replace(/\.js$/i, ".html")
      );
      const { props } = await getStaticProps({ params });
      const body = ReactDOMServer.renderToString(
        React.createElement(ReactRoot, {}, React.createElement(Page, props))
      );

      const head = ReactDOMServer.renderToString(
        React.createElement(
          React.Fragment,
          {},
          React.createElement(Head),
          React.createElement(
            "script",
            {},
            `window.FUEGO_PROPS=${JSON.stringify(props)}`
          ),
          React.createElement("script", { src: `/${pagePath}` })
        )
      );
      const transformHead = (_html.transformHead || ((h) => h)) as (
        head: string,
        body: string
      ) => string;
      fs.writeFileSync(
        outfile,
        `<!DOCTYPE html>
<html>
  <head>
    ${transformHead(head, body)}
  </head>
  <body>
    ${body}
  </body>
</html>
`
      );
      return 0;
    })
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
      const { outdir = "", ...restOpts } = opts;
      if (entryRegex.test(file)) {
        console.log(`building ${file}...`);
        build({
          ...restOpts,
          entryPoints: [file],
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

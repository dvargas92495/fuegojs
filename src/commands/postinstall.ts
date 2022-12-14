import { build as esbuild, Plugin } from "esbuild";
import fs from "fs";
import path from "path";
import { appPath, readDir } from "../internal/common";
import { FuegoConfig } from "../types";

const canvasPatch: Plugin = {
  name: "canvas-patch",
  setup: (build) => {
    build.onLoad({ filter: /.*\.js$/ }, async (args) => {
      let contents = await fs.promises.readFile(args.path, "utf8");

      contents = contents.replace(
        'const Canvas = require("canvas");',
        `const Canvas = null;`
      );

      return { contents, loader: "js" };
    });
  },
};

const postinstall = (): Promise<number> => {
  const packageJson = JSON.parse(
    fs.readFileSync(appPath("package.json")).toString()
  );
  const fuegoConfig = Object.keys(packageJson.dependencies || {})
    .map((k) => {
      const jsonPath = appPath(`node_modules/${k}/package.json`);
      if (!fs.existsSync(jsonPath)) {
        console.log("could not find package json for dependency", k);
        return {};
      }
      const depPackageJson = JSON.parse(
        fs.readFileSync(appPath(`node_modules/${k}/package.json`)).toString()
      );
      const config = (depPackageJson.fuego || {}) as FuegoConfig;
      return config.postinstall
        ? {
            ...config,
            postinstall: config.postinstall.map(
              (s) => `node_modules/${k}/${s}`
            ),
          }
        : config;
    })
    .reduce(
      (p, c) => ({ ...p, ...c }), // TODO safe merging
      (packageJson?.fuego || {}) as FuegoConfig
    );
  console.log("Fuego config:\n", JSON.stringify(fuegoConfig, null, 4));
  // TODO: ZOD

  const fuegoRemixConfig = fuegoConfig?.remix || {};
  const modulesToTranspile = (fuegoRemixConfig?.modulesToTranspile ||
    []) as string[];
  console.log(
    "About to transpile",
    modulesToTranspile.length,
    "modules from esm to cjs"
  );

  const files = modulesToTranspile.flatMap((m) =>
    readDir(`./node_modules/${m}`)
  );
  const jsFiles = files.filter((s) => /\.js$/.test(s));
  const jsonFiles = files.filter((s) => /\.json$/.test(s));
  console.log("transpiling", jsFiles.length, "files now...");
  let count = 0;
  return Promise.all(
    jsFiles.map((s) =>
      esbuild({
        entryPoints: [s],
        outfile: s,
        format: "cjs",
        allowOverwrite: true,
        target: "node14",
        plugins: [canvasPatch],
        platform: "neutral",
      }).then(() => {
        count++;
        if (count % 500 === 0) {
          console.log("done transpiling", count, "files...");
        }
      })
    )
  )
    .then((s) => console.log("transpiled", s.length, "files"))
    .then(async () => {
      console.log(
        "now checking",
        jsonFiles.length,
        "package.jsons to remove `type:module`..."
      );
      jsonFiles
        .filter((j) => /package\.json$/.test(j))
        .forEach((jsonFile) => {
          try {
            const packageJson = JSON.parse(
              fs.readFileSync(jsonFile).toString()
            );
            if (packageJson.type === "module") {
              delete packageJson.type;
              fs.writeFileSync(jsonFile, JSON.stringify(packageJson, null, 4));
              console.log("overwrote", jsonFile);
            }
          } catch (e) {
            console.error("Failed to overwrite", jsonFile);
            console.error(e);
          }
        });

      // Remove Hack once https://github.com/remix-run/remix/pull/1841 is merged
      if (fuegoRemixConfig.externals) {
        const compilerFile = "./node_modules/@remix-run/dev/dist/compiler.js";
        const compiler = fs
          .readFileSync("./node_modules/@remix-run/dev/dist/compiler.js")
          .toString();
        const inject = JSON.stringify(fuegoRemixConfig.externals);
        fs.writeFileSync(
          compilerFile,
          compiler
            .replace(
              "platform: config.serverPlatform,",
              `platform: config.serverPlatform,\n    external: ${inject},`
            )
            .replace(
              "external: externals,",
              `external: externals.concat(${inject}),`
            )
            .replace(
              "ignoreInitial: true,",
              "ignoreInitial: true,\n      ignored: /app\\/server\\//,"
            )
        );
        console.log(
          "hacked modules",
          fuegoRemixConfig.externals,
          "as externals"
        );
      }

      // Remove Hack once I merge this config
      const remixConfigServerBuildPath = await import(
        appPath("remix.config.js")
      ).then((config) => (config?.serverBuildPath as string) || "");
      if (remixConfigServerBuildPath.startsWith("app")) {
        const compilerFile = "./node_modules/@remix-run/dev/dist/compiler.js";
        const compiler = fs.readFileSync(compilerFile).toString();
        const ignored = `/${remixConfigServerBuildPath.replace(/\//g, "\\/")}/`;
        fs.writeFileSync(
          compilerFile,
          compiler.replace(
            "ignoreInitial: true,\n    awaitWriteFinish",
            `ignoreInitial: true,\n    ignored: ${ignored},\n    awaitWriteFinish`
          )
        );
        console.log("hacked chokidar ignore to", ignored);
      }

      // Hack the dev server to serve static files from node modules
      const staticDevPaths = ["node_modules"].concat(
        fuegoRemixConfig.staticDevPaths || []
      );
      const commandsFile = "./node_modules/@remix-run/dev/dist/cli/commands.js";
      const commandsFileContent = fs.readFileSync(commandsFile).toString();
      const commandsFileProcessed = staticDevPaths.reduce(
        (p, c) =>
          p.replace(
            /\s*app.use\(createApp/,
            `  app.use("/${c}", express.static('${c}'));\n  app.use(createApp`
          ),
        commandsFileContent
      );
      fs.writeFileSync(commandsFile, commandsFileProcessed);
      console.log("hacked dev server with static paths:", staticDevPaths);

      (fuegoConfig.postinstall || []).forEach((s) =>
        require(path.relative(__dirname, appPath(s)))
      );
    })
    .then(() => console.log("done!"))
    .then(() => 0);
};

export default postinstall;

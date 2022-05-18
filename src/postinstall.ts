import { setupRemix, SetupPlatform } from "@remix-run/dev/cli/setup";
import { build as esbuild, Plugin } from "esbuild";
import fs from "fs";
import { appPath, readDir } from "./common";

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

const postinstall = (modulesToTranspile: string[]): Promise<number> => {
  console.log(
    "About to transpile",
    modulesToTranspile.length - 1,
    "modules from esm to cjs"
  );
  const files = modulesToTranspile
    .slice(1)
    .flatMap((m) => readDir(`./node_modules/${m}`));
  const fuegoConfig = JSON.parse(
    fs.readFileSync(appPath("package.json")).toString()
  )?.fuego;
  const fuegoRemixConfig = fuegoConfig?.remix;

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
    .then(() => {
      console.log(
        "now checking",
        jsonFiles.length,
        "package.jsons to remove `type:module`..."
      );
      jsonFiles.forEach((jsonFile) => {
        const packageJson = JSON.parse(fs.readFileSync(jsonFile).toString());
        if (packageJson.type === "module") {
          delete packageJson.type;
          fs.writeFileSync(jsonFile, JSON.stringify(packageJson, null, 4));
          console.log("overwrote", jsonFile);
        }
      });
      console.log("now finally run remix setup node");
      return setupRemix(SetupPlatform.Node);
    })
    .then(async () => {
      // Remove Hack once https://github.com/remix-run/remix/pull/1841 is merged
      if (fuegoRemixConfig?.externals) {
        const compilerFile = "./node_modules/@remix-run/dev/compiler.js";
        const compiler = fs
          .readFileSync("./node_modules/@remix-run/dev/compiler.js")
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
        const compilerFile = "./node_modules/@remix-run/dev/compiler.js";
        const compiler = fs
          .readFileSync("./node_modules/@remix-run/dev/compiler.js")
          .toString();
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
    })
    .then(() => console.log("done!"))
    .then(() => 0);
};

export default postinstall;

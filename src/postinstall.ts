import { setupRemix, SetupPlatform } from "@remix-run/dev/setup";
import { build as esbuild, Plugin } from "esbuild";
import fs from "fs";
import { readDir } from "./common";

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
    modulesToTranspile.length,
    "modules from esm to cjs"
  );
  const files = modulesToTranspile.flatMap((m) =>
    readDir(`./node_modules/${m}`)
  );

  const jsFiles = files.filter((s) => /\.js$/.test(s));
  // Doesn't make much of a perf difference I think...
  /* .filter((f) => {
      const ESM_KEYWORDS = ["import", "export default"];
      const content = fs.readFileSync(f).toString();
      return ESM_KEYWORDS.some((k) => content.includes(k));
    });*/
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
    .then(() => {
      if (
        fs.existsSync("./node_modules/@remix-run/react/node_modules") &&
        fs.existsSync("./node_modules/react-router-dom")
      ) {
        // need to have one version of react router - not sure why this is happening
        fs.rmdirSync("./node_modules/@remix-run/react/node_modules");
      }
    })
    .then(() => console.log("done!"))
    .then(() => 0);
};

export default postinstall;

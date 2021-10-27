import { build as esbuild } from "esbuild";
import fs from "fs";
import {
  feBuildOpts,
  INTERMEDIATE_DIR,
  outputHtmlFiles,
  prepareFeBuild,
  promiseRimraf,
  readDir,
} from "./common";

type BuildArgs = { path?: string };

const commonRegex = /^pages[/\\]_common/;
const dynamicRegex = /[[]]/;
const buildDir = ({ path = "" }: BuildArgs): Promise<number> => {
  const entryPoints = path
    ? [`pages/${path}`].concat(
        fs.existsSync("pages/_html.tsx") ? ["pages/_html.tsx"] : []
      )
    : readDir("pages")
        .filter((p) => !commonRegex.test(p))
        .filter((p) => !dynamicRegex.test(p));
  process.env.NODE_ENV = "production";
  return esbuild({
    entryPoints,
    ...feBuildOpts,
  }).then((result) => {
    if (result.errors.length) {
      throw new Error(JSON.stringify(result.errors));
    }
    return outputHtmlFiles(entryPoints);
  });
};

const build = (args: BuildArgs = {}): Promise<number> =>
  prepareFeBuild()
    .then(() => buildDir(args))
    .then((code) =>
      promiseRimraf(INTERMEDIATE_DIR).then(() => {
        console.log("Finished!");
        return code;
      })
    )
    .catch((e) =>
      promiseRimraf(INTERMEDIATE_DIR).then(() => {
        console.error("ERROR:", e.message);
        return 1;
      })
    );

export default build;

import path from "path";
import esbuild from "esbuild";
import {
  feBuildOpts,
  INTERMEDIATE_DIR,
  outputHtmlFiles,
  prepareFeBuild,
  promiseRimraf,
  readDir,
} from "./common";

const buildDir = (): Promise<number> => {
  const entryPoints = readDir("pages");
  return esbuild
    .build({
      entryPoints,
      ...feBuildOpts,
    })
    .then((result) => {
      if (result.errors.length) {
        throw new Error(JSON.stringify(result.errors));
      }
      return outputHtmlFiles(entryPoints);
    });
};

const build = (): Promise<number> =>
  prepareFeBuild()
    .then(() => buildDir())
    .then((code) => {
      return promiseRimraf(INTERMEDIATE_DIR).then(() => {
        console.log("Finished!");
        return code;
      });
    })
    .catch((e) => {
      return promiseRimraf(INTERMEDIATE_DIR).then(() => {
        console.error("ERROR:", e.message);
        return 1;
      });
    });

export default build;

import { build as esbuild } from "esbuild";
import {
  feBuildOpts,
  INTERMEDIATE_DIR,
  outputHtmlFiles,
  prepareFeBuild,
  promiseRimraf,
  readDir,
} from "./common";

const buildDir = (): Promise<number> => {
  const commonRegex = /^pages[/\\]_common/;
  const entryPoints = readDir("pages").filter((p) => !commonRegex.test(p));
  process.env.NODE_ENV = 'production';
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

const build = (): Promise<number> =>
  prepareFeBuild()
    .then(() => buildDir())
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

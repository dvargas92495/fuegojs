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

type BuildArgs = { path?: string | string[] };

const commonRegex = /^pages[/\\]_common/;
const dynamicRegex = /[[\]]/;
const getEntryPoints = (paths: string[]) => {
  const pages = readDir("pages").filter((p) => !commonRegex.test(p));
  if (paths.length) {
    const pageRegexes = pages.map((page) => ({
      page,
      regex: new RegExp(
        `^${page
          .replace(/^pages[/\\]/, "")
          .replace(/[/\\]/g, "\\/")
          .replace(/\[([a-z0-9-]+)\]/, (_, name) => `(?<${name}>[a-z0-9-]+)`)
          .replace(/\.[t|j]sx?/, "")}$`
      ),
    }));
    return paths
      .map((path) => ({
        result: pageRegexes.find(({ regex }) => regex.test(path)),
        path,
      }))
      .filter(({ result }) => !!result)
      .map(({ result, path }) => ({
        entry: result?.page || "",
        params: result?.regex.exec(path)?.groups || {},
      }))
      .concat(
        fs.existsSync("pages/_html.tsx")
          ? [{ entry: "pages/_html.tsx", params: {} }]
          : []
      );
  }
  return pages
    .filter((p) => !dynamicRegex.test(p))
    .map((entry) => ({ entry, params: {} }));
};

const buildDir = ({ path = "" }: BuildArgs): Promise<number> => {
  const paths = typeof path === "object" ? path : path ? [path] : [];
  const entryPoints = getEntryPoints(paths);
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  return esbuild({
    entryPoints: Array.from(new Set(entryPoints.map(({ entry }) => entry))),
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

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
const dataRegex = /\.data\.[t|j]sx?/;
const getEntryPoints = (paths: string[]) => {
  const pages = readDir("pages").filter((p) => !commonRegex.test(p));
  if (paths.length) {
    const dataPages = Object.fromEntries(
      pages
        .filter((p) => dataRegex.test(p))
        .map((p) => [p.replace(/\.[t|j]sx?$/, ""), p])
    );
    const pageRegexes = pages
      .filter((p) => !dataRegex.test(p))
      .map((page) => ({
        page,
        regex: new RegExp(
          `^${page
            .replace(/^pages[/\\]/, "")
            .replace(/[/\\]/g, "\\/")
            .replace(/\[([a-z0-9-]+)\]/, (_, name) => `(?<${name}>[a-z0-9-]+)`)
            .replace(/\.[t|j]sx?/, "")}$`
        ),
        data: dataPages[page.replace(/\.[t|j]sx?/, "")],
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
        data: result?.data,
      }))
      .concat(
        fs.existsSync("pages/_html.tsx")
          ? [{ entry: "pages/_html.tsx", params: {}, data: undefined }]
          : []
      );
  }
  return pages
    .filter((p) => !dynamicRegex.test(p))
    .map((entry) => ({ entry, params: {}, data: undefined }));
};

const buildDir = ({ path = "" }: BuildArgs): Promise<number> => {
  const paths = typeof path === "object" ? path : path ? [path] : [];
  const entryPoints = getEntryPoints(paths);
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  return Promise.all([
    esbuild({
      entryPoints: Object.fromEntries(
        Array.from(
          new Set(
            entryPoints
              .map(({ entry, data }) => (data ? [entry, data] : [entry]))
              .flat()
          )
        ).map((e) => [
          e
            .replace(/^pages[/\\]/, "")
            .replace(/\.[t|j]sx?$/, ".server.js")
            .replace(/\.data\.server\.js$/, ".data.js"),
          e,
        ])
      ),
      platform: "node",
      ...feBuildOpts,
    }),
    esbuild({
      entryPoints: Object.fromEntries(
        Array.from(new Set(entryPoints.map(({ entry }) => entry))).map((e) => [
          e.replace(/^pages[/\\]/, "").replace(/\.[t|j]sx?/, ".client.js"),
          e,
        ])
      ),
      platform: "node",
      ...feBuildOpts,
    }),
  ]).then(([serverResults, clientResults]) => {
    if (serverResults.errors.length) {
      throw new Error(
        `Server Side Failed: ${JSON.stringify(serverResults.errors)}`
      );
    }
    if (clientResults.errors.length) {
      throw new Error(
        `Client Side Failed: ${JSON.stringify(serverResults.errors)}`
      );
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

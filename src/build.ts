import { build as esbuild } from "esbuild";
import {
  feBuildOpts,
  feMapFile,
  INTERMEDIATE_DIR,
  prepareFeBuild,
  promiseRimraf,
  readDir,
} from "./common";
import { outputHtmlFiles } from "./esbuild-helpers";
import fs from 'fs';
import nodepath from 'path';

type BuildArgs = { path?: string | string[] };

const commonRegex = /^pages[/\\]_/;
const dynamicRegex = /[[\]]/;
const dataRegex = /\.data\.[t|j]sx?/;
const getEntryPoints = (paths: string[]) => {
  const pages = readDir("pages").filter((p) => !commonRegex.test(p));
  if (paths.length) {
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
      }));
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
    entryPoints: entryPoints.map((e) => feMapFile(e.entry)),
    ...feBuildOpts,
  }).then((clientResults) => {
    if (clientResults.errors.length) {
      throw new Error(
        `Client Side Failed: ${JSON.stringify(clientResults.errors)}`
      );
    }
    readDir('files').forEach(f => {
      const base = f.replace(/^files\//, '');
      fs.copyFileSync(f, nodepath.join('out', base));
    })
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

import { build as esbuild, BuildOptions } from "esbuild";
import {
  appPath,
  feMapFile,
  FE_OUT_DIR,
  getDotEnvObject,
  INTERMEDIATE_DIR,
  prepareFeBuild,
  promiseRimraf,
  readDir,
} from "./common";
import { outputHtmlFiles } from "./esbuild-helpers";
import fs from "fs";
import nodepath from "path";
import { build as remixBuild } from "@remix-run/dev/cli/commands";

type BuildArgs = {
  path?: string | string[];
  remix?: boolean;
  readable?: boolean;
};

const commonRegex = /^pages[/\\]_/;
const dataRegex = /\.data\.[t|j]sx?/;
const getEntryPoints = (paths: string[]) => {
  const pages = readDir("pages")
    .filter((p) => !commonRegex.test(p))
    .filter((p) => !dataRegex.test(p));
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
        exclude: false,
      }));
  }
  return pages.map((entry) => ({
    entry,
    params: {},
    exclude: /\[[a-z0-9-]+\]/.test(entry),
  }));
};

const buildDir = (
  { path = "" }: BuildArgs,
  feBuildOpts: BuildOptions
): Promise<number> => {
  const paths = typeof path === "object" ? path : path ? [path] : [];
  const entryPoints = getEntryPoints(paths);
  return esbuild({
    entryPoints: entryPoints.map((e) => feMapFile(e.entry)),
    ...feBuildOpts,
  }).then((clientResults) => {
    if (clientResults.errors.length) {
      throw new Error(
        `Client Side Failed: ${JSON.stringify(clientResults.errors)}`
      );
    }
    readDir("files").forEach((f) => {
      const base = f.replace(/^files\//, "");
      const outfile = nodepath.join(
        process.env.FE_DIR_PREFIX || "",
        "out",
        base
      );
      const baseDir = nodepath.dirname(outfile);
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
      fs.copyFileSync(f, outfile);
    });
    return outputHtmlFiles(entryPoints.filter(({ exclude }) => !exclude));
  });
};

const buildWithRemix = ({ readable = false } = {}) => {
  const fuegoRemixConfig =
    JSON.parse(fs.readFileSync(appPath("package.json")).toString())?.fuego
      ?.remixConfig || {};
  const remixConfigFile = appPath("remix.config.js");
  const existingRemixConfig = fs.existsSync(remixConfigFile)
    ? require(remixConfigFile)
    : {};
  const newRemixConfig = {
    ...existingRemixConfig,
    serverBuildDirectory: "server/build",
    ...fuegoRemixConfig,
  };
  fs.writeFileSync(
    remixConfigFile,
    `/**
 * @type {import('@remix-run/dev/config').AppConfig}
 */
module.exports = ${JSON.stringify(newRemixConfig, null, 4)};`
  );
  return remixBuild(process.cwd(), process.env.NODE_ENV)
    .then(() =>
      esbuild({
        bundle: true,
        outdir: FE_OUT_DIR,
        platform: "node",
        target: "node14",
        entryPoints: ["server/index.ts"],
        external: ["aws-sdk"],
        minify: !readable,
        define: getDotEnvObject(),
      })
    )
    .then(() => 0);
};

const build = (args: BuildArgs = {}): Promise<number> => {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  if (args.remix) {
    return buildWithRemix({ readable: args.readable });
  }
  return prepareFeBuild()
    .then((opts) => buildDir(args, opts))
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
};

export default build;

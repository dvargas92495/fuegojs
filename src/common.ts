import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import dotenv from "dotenv";
import type { Express } from "express";
import type { BuildOptions } from "esbuild";
dotenv.config();

export const INTERMEDIATE_DIR = "_fuego";
export const relativeToIntermediate = (s: string): string =>
  path.relative(INTERMEDIATE_DIR, s).replace(/\\/g, "/");

export const appPath = (p: string): string =>
  path.resolve(fs.realpathSync(process.cwd()), p);

export const readDir = (s: string): string[] =>
  fs
    .readdirSync(s, { withFileTypes: true })
    .flatMap((f) =>
      f.isDirectory() ? readDir(`${s}/${f.name}`) : [`${s}/${f.name}`]
    );

const IGNORE_ENV = ["HOME"];
export const getDotEnvObject = (): Record<string, string> => {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => !/[()]/.test(k))
        .filter(([k]) => !IGNORE_ENV.includes(k))
    ),
  };
  return Object.fromEntries(
    Object.keys(env).map((k) => [`process.env.${k}`, JSON.stringify(env[k])])
  );
};

export const feBuildOpts = {
  platform: "browser" as const,
  minify: true,
  bundle: true,
  outdir: "out",
  define: getDotEnvObject(),
};

export const feMapFile = (s: string): string => {
  const newEntry = appPath(
    `${s.replace(/^pages[/\\]/, `${INTERMEDIATE_DIR}/`)}`
  );
  const newDir = path.dirname(newEntry);
  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(
    newEntry,
    `import React from 'react';
import ReactDOM from 'react-dom';
import Page from '${relativeToIntermediate(s)}';
const props = window.FUEGO_PROPS || {};
window.onload = () => ReactDOM.hydrate(<Page {...props}/>, document.body.firstElementChild);`
  );
  return newEntry;
};

export const promiseRimraf = (s: string): Promise<null | void | Error> =>
  new Promise((resolve) => rimraf(s, resolve));

export const prepareFeBuild = (): Promise<void> =>
  Promise.all([promiseRimraf(INTERMEDIATE_DIR), promiseRimraf("out")]).then(
    () => {
      fs.mkdirSync(INTERMEDIATE_DIR);
      fs.mkdirSync("out");
      return Promise.resolve();
    }
  );

export const prepareApiBuild = (): Promise<Partial<BuildOptions>> =>
  promiseRimraf("build").then(() => {
    return {
      bundle: true,
      outdir: appPath("build"),
      platform: "node",
      external: ["aws-sdk", "canvas"],
      define: getDotEnvObject(),
    };
  });

export const setupServer = ({
  app,
  port,
  label,
}: {
  app: Express;
  port: number;
  label: string;
}): Promise<number> =>
  new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`${label} server listening on port ${port}...`);
    });
    process.on("exit", () => {
      console.log("Closing...");
      resolve(0);
    });
  });

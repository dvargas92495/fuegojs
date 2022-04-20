import { build as esbuild } from "esbuild";
import { appPath, FE_OUT_DIR, getDotEnvObject } from "./common";
import fs from "fs";
import { build as remixBuild } from "@remix-run/dev/cli/commands";

type BuildArgs = {
  readable?: boolean;
};

const build = async (args: BuildArgs = {}): Promise<number> => {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  const fuegoConfig = JSON.parse(
    fs.readFileSync(appPath("package.json")).toString()
  )?.fuego;
  const fuegoRemixConfig = fuegoConfig?.remix || {};
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

  // HOW WOULD I BUNDLE TAILWIND?
  //
  // const fuegoTailwindConfig = fuegoConfig?.tailwind;
  // if (fuegoTailwindConfig) {
  //   const { content, theme, ...config } = fuegoTailwindConfig;
  //   await tailwindcss({
  //     content: ["./app/**/*.tsx", ...(content || [])],
  //     theme: theme || { extend: {} },
  //     ...config,
  //   });
  // }

  return remixBuild(process.cwd(), process.env.NODE_ENV)
    .then(() =>
      esbuild({
        bundle: true,
        outdir: FE_OUT_DIR,
        platform: "node",
        target: "node14",
        entryPoints: ["server/index.ts"],
        external: ["aws-sdk"].concat(fuegoRemixConfig?.externals || []),
        minify: !args.readable,
        define: getDotEnvObject(),
      })
    )
    .then(() => 0);
};

export default build;

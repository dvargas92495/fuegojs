import { createApp } from "@remix-run/dev/cli/create";
import fs from "fs";
import path from "path";
import { build as esbuild } from "esbuild";

type Args = {
  domain?: string;
  template?: string;
};

const init = ({ domain, template }: Args = {}): Promise<number> => {
  if (!domain) return Promise.reject("--domain is required");
  if (!template) return Promise.reject("--template is required");
  const packageJson = JSON.parse(fs.readFileSync("./package.json").toString());
  const remixVersion = (
    packageJson.dependencies["@remix-run/dev"] || ""
  ).replace(/^[~^]/, "");
  return createApp({
    appTemplate: template,
    projectDir: path.resolve(process.cwd(), domain),
    remixVersion,
    installDeps: true,
    useTypeScript: true,
    githubToken: process.env.GITHUB_TOKEN,
  }).then(async () => {
    console.log("💿 Running remix.init script");
    const initScriptDir = path.join(domain, "remix.init");
    const outfile = path.resolve(initScriptDir, "index.js");
    await esbuild({
      entryPoints: [path.resolve(initScriptDir, "index.ts")],
      bundle: true,
      platform: "node",
      outfile,
    });

    try {
      await import(outfile).then((initFn) =>
        initFn({
          rootDirectory: domain,
        })
      );
    } catch (error) {
      console.error(`🚨 Oops, remix.init failed`);
      throw error;
    }
    fs.rmSync(initScriptDir, { force: true, recursive: true });
    return 0;
  });
};

export default init;

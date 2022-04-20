import { createApp } from "@remix-run/dev/cli/create";
import fs from "fs";
import path from "path";
import { build as esbuild } from "esbuild";
import child_process from "child_process";

type Args = {
  domain?: string;
  template?: string;
};

const patchRemix = () => {
  const name = path.join(
    __dirname,
    "../node_modules/@remix-run/dev/cli/create.js"
  );

  const content = fs.readFileSync(name).toString();
  fs.writeFileSync(
    name,
    content.replace(
      `filePath = filePath.replaceAll("\\\\", "/");`,
      `filePath = filePath.split(path.sep).join(path.posix.sep)`
    )
  );
};

const init = ({ domain, template }: Args = {}): Promise<number> => {
  if (!domain) return Promise.reject("--domain is required");
  if (!template) return Promise.reject("--template is required");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json")).toString()
  );
  const remixVersion = (
    packageJson.dependencies["@remix-run/dev"] || ""
  ).replace(/^[~^]/, "");
  const appTemplate = template.startsWith("https://github.com/")
    ? template
    : `https://github.com/${template}`;
  // TODO: Remove with remix 1.4.2
  patchRemix();
  return createApp({
    appTemplate,
    projectDir: path.resolve(process.cwd(), domain),
    remixVersion,
    packageManager: "npm",
    installDeps: true,
    useTypeScript: true,
    githubToken: process.env.GITHUB_TOKEN,
  }).then(async () => {
    console.log("💿 Running remix.init script");
    const initScriptDir = path.join(domain, "remix.init");
    child_process.execSync("npm install", {
      stdio: "ignore",
      cwd: initScriptDir,
    });
    const outfile = path.resolve(initScriptDir, "index.js");
    await esbuild({
      entryPoints: [path.resolve(initScriptDir, "index.ts")],
      format: "cjs",
      platform: "node",
      outfile,
    });

    try {
      await import(outfile).then((initFn) =>
        initFn.default({
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

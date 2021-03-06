import fs from "fs";
import path from "path";
import { build as esbuild } from "esbuild";
import child_process from "child_process";

type Args = {
  domain?: string;
  template?: string;
};

const init = ({
  domain,
  template = "dvargas92495/fuegojs/tree/main/template",
}: Args = {}): Promise<number> => {
  if (!domain) return Promise.reject("--domain is required");
  const appTemplate = template.startsWith("https://github.com/")
    ? template
    : `https://github.com/${template}`;
  const projectDir = path.resolve(process.cwd(), domain);
  return import("@remix-run/dev/dist/cli/create.js")
    .then((d) =>
      d.createApp({
        appTemplate,
        projectDir: path.resolve(process.cwd(), domain),
        installDeps: false,
        useTypeScript: true,
        githubToken: process.env.GITHUB_TOKEN,
      })
    )
    .then(async () => {
      console.log("Setting latest deps");
      const packageJson = path.join(domain, "package.json");
      const json = JSON.parse(fs.readFileSync(packageJson).toString());
      const searchDependencies = (deps: Record<string, string>) =>
        Promise.all(
          Object.entries(deps).map(([k, v]) => {
            if (v === "**") {
              return new Promise((resolve) =>
                child_process.exec(`npm show ${k} version`, (_, stdout) =>
                  resolve(`^${stdout.replace("\n", "")}`)
                )
              ).then((version) => {
                console.log("found version", version, "for", k);
                return [k, version];
              });
            } else {
              return Promise.resolve([k, v]);
            }
          })
        ).then((entries) => Object.fromEntries(entries));

      await Promise.all([
        searchDependencies(json.dependencies),
        searchDependencies(json.devDependencies),
      ]).then(([dep, dev]) => {
        json.dependencies = dep;
        json.devDependencies = dev;
        fs.writeFileSync(packageJson, JSON.stringify(json, null, 2));
      });
      console.log("💿 Installing dependencies in project");
      child_process.execSync(`npm install`, {
        stdio: "inherit",
        cwd: projectDir,
      });
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

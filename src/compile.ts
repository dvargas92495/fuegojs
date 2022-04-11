import fs from "fs";
import { build as esbuild } from "esbuild";
import { readDir } from "./common";
import { prepareApiBuild } from "./esbuild-helpers";

const compile = ({
  readable = false,
  path = "api",
}: {
  readable?: boolean;
  path?: string;
}): Promise<number> => {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  const commonRegex = new RegExp(`^${path}[/\\\\]_common`);
  return fs.existsSync(path)
    ? prepareApiBuild()
        .then((opts) =>
          esbuild({
            ...opts,
            entryPoints: Object.fromEntries(
              readDir(path)
                .filter((f) => !commonRegex.test(f))
                .map((f) => [
                  f.replace(/\.[t|j]s$/, "").replace(new RegExp(`^${path}[/\\\\]`), ""),
                  `./${f}`,
                ])
            ),
            minify: !readable,
          })
        )
        .then((r) => {
          if (r.errors.length) {
            throw new Error(JSON.stringify(r.errors));
          } else {
            return r.errors.length;
          }
        })
    : Promise.resolve().then(() => {
        console.log(`No \`${path}\` directory to compile. Exiting...`);
        return 0;
      });
};

export default compile;

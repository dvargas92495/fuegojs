import fs from "fs";
import { build as esbuild } from "esbuild";
import { readDir } from "./common";
import { prepareApiBuild } from "./esbuild-helpers";

const commonRegex = /^functions[/\\]_common/;

const compile = ({
  readable = false,
}: {
  readable?: boolean;
}): Promise<number> => {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  return fs.existsSync("functions")
    ? prepareApiBuild()
        .then((opts) =>
          esbuild({
            ...opts,
            entryPoints: Object.fromEntries(
              readDir("functions")
                .filter((f) => !commonRegex.test(f))
                .map((f) => [
                  f.replace(/\.[t|j]s$/, "").replace(/^functions[/\\]/, ""),
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
        console.log("No `functions` directory to compile. Exiting...");
        return 0;
      });
};

export default compile;

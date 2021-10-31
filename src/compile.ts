import fs from "fs";
import { build as esbuild } from "esbuild";
import { prepareApiBuild, readDir } from "./common";

const commonRegex = /^functions[/\\]_common/;

const compile = (): Promise<number> =>
  fs.existsSync("functions")
    ? prepareApiBuild()
        .then((opts) => {
          process.env.NODE_ENV = process.env.NODE_ENV || "production";
          return esbuild({
            ...opts,
            entryPoints: Object.fromEntries(
              readDir("functions")
                .filter((f) => !commonRegex.test(f))
                .map((f) => [
                  f.replace(/\.[t|j]s$/, "").replace(/^functions[/\\]/, ""),
                  `./${f}`,
                ])
            ),
            minify: true,
          });
        })
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

export default compile;

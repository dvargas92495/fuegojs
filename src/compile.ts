import fs from "fs";
import { build as esbuild } from "esbuild";
import { prepareApiBuild, readDir } from "./common";

const commonRegex = /^functions[/\\]_common/;

const compile = (): Promise<number> =>
  fs.existsSync("functions")
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
            // mysql npm package has a bug when function names are minified -.-
            // issue: https://github.com/mysqljs/mysql/issues/1655
            // PR: https://github.com/mysqljs/mysql/pull/2375/files
            // minify: true,
            minifySyntax: true,
            minifyWhitespace: true,
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

export default compile;

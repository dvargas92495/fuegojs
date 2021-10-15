import { build as esbuild } from "esbuild";
import { prepareApiBuild, readDir } from "./common";

const commonRegex = /^functions[/\\]_common/;

const compile = (): Promise<number> =>
  prepareApiBuild()
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
        minify: true,
      })
    )
    .then((r) => {
      if (r.errors.length) {
        throw new Error(JSON.stringify(r.errors));
      } else {
        return r.errors.length;
      }
    });

export default compile;

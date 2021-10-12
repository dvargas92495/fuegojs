import { build as esbuild } from "esbuild";
import fs from "fs";
import { prepareApiBuild } from "./common";

const compile = (): Promise<number> =>
  prepareApiBuild()
    .then((opts) =>
      esbuild({
        ...opts,
        entryPoints: Object.fromEntries(
          fs
            .readdirSync("./functions/", { withFileTypes: true })
            .filter((f) => !f.isDirectory())
            .map((f) => f.name)
            .map((f) => [f.replace(/\.[t|j]s$/, ""), `./functions/${f}`])
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

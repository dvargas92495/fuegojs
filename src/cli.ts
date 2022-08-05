#!/usr/bin/env node
import init from "./init";
import build from "./build";
import deploy from "./deploy";
import dev from "./dev";
import compile from "./compile";
import publish from "./publish";
import api from "./api";
import postinstall from "./postinstall";
import migrate from "./migrate";
import apply from "./apply";
import plan from "./plan";

const run = async (command: string, args: string[]): Promise<number> => {
  const opts = args
    .map(
      (a, i) =>
        [
          a,
          args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true,
        ] as const
    )
    .filter(([k]) => k.startsWith("--"))
    .map(
      ([k, v]) =>
        [
          k
            .replace(/^--/, "")
            .split(/-/g)
            .map((s, i) =>
              i === 0
                ? s
                : `${s.substring(0, 1).toUpperCase()}${s.substring(1)}`
            )
            .join(""),
          v,
        ] as const
    )
    .reduce((prev, [k, v]) => {
      const prevK = prev[k];
      if (v === true) {
        prev[k] = v;
      } else if (prevK) {
        if (typeof prevK === "string") {
          prev[k] = [prevK, v];
        } else if (prevK !== true) {
          prev[k] = [...prevK, v];
        }
      } else {
        prev[k] = v;
      }
      return prev;
    }, {} as Record<string, string | string[] | boolean>);
  switch (command) {
    // APP
    case "build":
      return build(opts);
    case "deploy":
      return deploy(opts);
    case "dev":
      return dev(opts);
    // API
    case "compile":
      return compile(opts);
    case "publish":
      return publish(opts);
    case "api":
      return api(opts);
    // DATA
    case "apply":
      return apply(args);
    case "plan":
      return plan(args);
    case "migrate":
      return migrate(opts);
    // MISC
    case "init":
      return init(opts);
    case "postinstall":
      return postinstall();
    /**
     * TODO
     * - start - both
     */
    default:
      console.error("Command", command, "is unsupported");
      return 1;
  }
};

run(process.argv[2], process.argv.slice(3))
  .then((code) => code >= 0 && process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

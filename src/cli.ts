#!/usr/bin/env node
import build from "./build";
import deploy from "./deploy";
import fe from "./fe";
import compile from "./compile";
import publish from "./publish";
import api from "./api";

const run = async (command: string, args: string[]): Promise<number> => {
  const opts = Object.fromEntries(
    args
      .map(
        (a, i) =>
          [
            a,
            args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true,
          ] as const
      )
      .filter(([k]) => k.startsWith("--"))
      .map(([k, v]) => [
        k
          .replace(/^--/, "")
          .split(/-/g)
          .map((s, i) =>
            i === 0 ? s : `${s.substring(0, 1).toUpperCase()}${s.substring(1)}`
          ),
        v,
      ])
  );
  switch (command) {
    case "build":
      return build();
    case "deploy":
      return deploy(opts);
    case "fe":
      return fe();
    case "compile":
      return compile();
    case "publish":
      return publish(opts);
    case "api":
      return api();
    /**
     * TODO
     * - start - both
     * - init - create a new app, utilize create-vargas-npm,
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

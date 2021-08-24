#!/usr/bin/env node
import build from "./build";

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
      .map(([k, v]) => [k.replace(/^--/, ""), v])
  );
  switch (command) {
    case "build":
      return build();
    case "deploy":
      return deploy(opts);
    /**
     * TODO
     * - build lambdas
     * - publish lambdas
     * - start - FE-only, BE-only, both
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

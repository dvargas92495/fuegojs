import { BuildOptions } from "esbuild";
import {
  appPath,
  getDotEnvObject,
  getFuegoConfig,
  promiseRimraf,
} from "./common";
import fs from "fs";
import path from "path";

const prepareApiBuild = (outputDir: string): Promise<Partial<BuildOptions>> =>
  promiseRimraf(outputDir).then(async () => {
    const baseOpts = {
      bundle: true,
      outdir: appPath(outputDir),
      platform: "node" as const,
      external: ["aws-sdk", "canvas", "@aws-sdk/*"],
      define: getDotEnvObject(),
    };
    const { functionFileDependencies = null } = getFuegoConfig();
    if (
      typeof functionFileDependencies === "object" &&
      functionFileDependencies
    ) {
      const filesToCopy = Object.values(functionFileDependencies)
        .filter((files) => !!files)
        .flatMap((files) =>
          typeof files === "string"
            ? [{ from: files, to: path.basename(files) }]
            : typeof files === "object"
            ? Object.values(files)
                .map((f) =>
                  typeof f === "string"
                    ? { from: f, to: path.basename(f) }
                    : typeof f === "object" && f
                    ? { from: (f as string[])[0], to: (f as string[])[1] }
                    : undefined
                )
                .filter((f) => !!f)
            : []
        ) as { from: string; to: string }[];
      if (filesToCopy.length) {
        fs.mkdirSync(appPath(outputDir), { recursive: true });
        Array.from(new Set(filesToCopy)).forEach(({ from, to }) => {
          const out = path.join(appPath(outputDir), to);
          if (!fs.existsSync(path.dirname(out)))
            fs.mkdirSync(path.dirname(out), { recursive: true });
          try {
            fs.copyFileSync(from, out);
          } catch (e) {
            console.error(`Failed to copy file from ${from} to ${out}`);
            console.error(e);
          }
        });
      }
    }
    return baseOpts;
  });

export default prepareApiBuild;

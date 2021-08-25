import fs from "fs";
import path from "path";

export const appPath = (p: string): string =>
  path.resolve(fs.realpathSync(process.cwd()), p);

export const readDir = (s: string): string[] =>
  fs
    .readdirSync(s, { withFileTypes: true })
    .flatMap((f) =>
      f.isDirectory() ? readDir(`${s}/${f.name}`) : [`${s}/${f.name}`]
    );

import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import dotenv from "dotenv";
dotenv.config();

export const FE_OUT_DIR = path.join(process.env.FE_DIR_PREFIX || "", "out");
export const FE_PUBLIC_DIR = path.join(
  process.env.FE_DIR_PREFIX || "",
  "public"
);
export const PLAN_OUT_FILE = "out/apply-sql.txt";
export const appPath = (p: string): string =>
  path.resolve(fs.realpathSync(process.cwd()), p);

export const readDir = (s: string): string[] =>
  fs.existsSync(s)
    ? fs
        .readdirSync(s, { withFileTypes: true })
        .flatMap((f) =>
          f.isDirectory() ? readDir(`${s}/${f.name}`) : [`${s}/${f.name}`]
        )
    : [];

const IGNORE_ENV = ["HOME"];
export const getDotEnvObject = (): Record<string, string> => {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => !/[()]/.test(k))
        .filter(([k]) => !IGNORE_ENV.includes(k))
    ),
  };
  return Object.fromEntries(
    Object.keys(env).map((k) => [`process.env.${k}`, JSON.stringify(env[k])])
  );
};

export const promiseRimraf = (s: string): Promise<null | void | Error> =>
  new Promise((resolve) => rimraf(s, resolve));

export type json =
  | string
  | number
  | boolean
  | null
  | { toJSON: () => string }
  | json[]
  | { [key: string]: json };

export const getFuegoConfig = (): {
  functionFileDependencies?: {
    [key: string]: string[] | string | [string, string][];
  };
} =>
  JSON.parse(fs.readFileSync(appPath("package.json")).toString())?.fuego || {};

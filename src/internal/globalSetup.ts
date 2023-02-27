import dotenv from "dotenv";
import fs from "fs";

const globalSetup = async () => {
  dotenv.config();

  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  if (process.env.DEBUG || process.env.PWDEBUG)
    process.env.DEBUG = process.env.DEBUG || process.env.PWDEBUG;
  if (fs.existsSync(`${process.cwd()}/tests/config.ts`)) {
    await import(`${process.cwd()}/tests/config`)
      .then((mod) => typeof mod.setup === "function" && mod.setup())
      .catch((e) => console.error("wah", e));
  }
};

export default globalSetup;

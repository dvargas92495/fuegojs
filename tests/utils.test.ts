import { test, expect } from "@playwright/test";
import getMysql from "../src/utils/mysql";
import base from "../src/utils/base";
import { z } from "zod";
import fs from "fs";
import { execSync } from "child_process";

const dbname = Array(8)
  .fill(null)
  .map(() =>
    String.fromCharCode("a".charCodeAt(0) + Math.floor(Math.random() * 26))
  )
  .join("");

test.beforeAll(() => {
  execSync(`echo "CREATE DATABASE ${dbname};" | mysql -uroot -proot`);
});

test.skip("mysql connect", async () => {
  const cxn = await getMysql();
  const [sel] = await cxn.execute("SELECT 1 as one");
  expect(sel).toEqual([{ one: 1 }]);
});

test("schema with indices", async () => {
  process.env.FUEGO_ARGS_SQL = "true";
  process.env.DATABASE_URL = `mysql://root:root@127.0.0.1:3306/${dbname}`;
  const schema = {
    entity: z
      .object({
        uuid: z.string().uuid(),
        plain: z.string().describe("index"),
        uniq: z.string().describe("unique"),
        first: z.string(),
        second: z.string(),
      })
      .describe(JSON.stringify({ uniques: [["first", "second"]] })),
  };
  await base({ schema, projectName: dbname });
  const plan = fs.readFileSync("out/apply-sql.txt").toString();
  expect(plan).toEqual(`CREATE TABLE IF NOT EXISTS entities (
  uuid  VARCHAR(36)  NOT NULL DEFAULT "",
  plain  VARCHAR(128)  NOT NULL DEFAULT "",
  uniq  VARCHAR(128)  NOT NULL DEFAULT "",
  first  VARCHAR(128)  NOT NULL DEFAULT "",
  second  VARCHAR(128)  NOT NULL DEFAULT "",

  UNIQUE INDEX UC_uniq (uniq),
  UNIQUE INDEX UC_first_second (first,second),
  INDEX IX_plain (plain)
)`);
});

test.afterAll(() => {
  execSync(`echo "DROP DATABASE ${dbname};" | mysql -uroot -proot`);
});

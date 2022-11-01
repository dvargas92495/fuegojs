import { test, expect } from "@playwright/test";
import getMysql from "../src/utils/mysql";

test.skip("mysql connect", async () => {
  const cxn = await getMysql();
  const [sel] = await cxn.execute("SELECT 1 as one");
  expect(sel).toEqual([{ one: 1 }]);
});

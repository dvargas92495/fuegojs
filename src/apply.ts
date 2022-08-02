import { PLAN_OUT_FILE } from "./common";
import getMysqlConnection from "./mysql";
import fs from "fs";
import migrate from "./migrate";

const apply = (): Promise<number> => {
  // TODO run manual migrations
  const queries = fs
    .readFileSync(PLAN_OUT_FILE)
    .toString()
    .split(";\n\n")
    .filter((s) => !!s);
  return queries.length
    ? getMysqlConnection().then(async (cxn) => {
        await queries
          .map((q, i, a) => async () => {
            console.log(`Running query ${i} of ${a.length}:`);
            console.log(">", q);
            await cxn.execute(q);
            console.log("Done!");
            console.log("");
          })
          .reduce((p, c) => p.then(c), Promise.resolve());
        cxn.destroy();
        return migrate({ cxn: cxn.connection });
      })
    : Promise.resolve().then(() => {
        console.log("No queries to run!");
        return 0;
      });
};

export default apply;

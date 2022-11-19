import mysql from "mysql2/promise";
import { v4 } from "uuid";

const connectionMap: Record<string, mysql.Connection> = {};

const createConnection = (id = v4()) => {
  return mysql
    .createConnection(process.env.DATABASE_URL || "")
    .then((con) => (connectionMap[id] = con))
    .catch((e) => {
      if (e.message === "Too many connections") {
        Object.entries(connectionMap)
          .filter(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore their types are bad
            ([, v]) => !v.connection.stream.destroyed
          )
          .forEach(([k]) => {
            console.log("Connections still open:", k);
          });
      }
      throw e;
    });
};

const getMysqlConnection = (mysql?: mysql.Connection | string) => {
  return typeof mysql === "undefined"
    ? createConnection()
    : typeof mysql === "string"
    ? Promise.resolve(connectionMap[mysql] || createConnection(mysql))
    : Promise.resolve(mysql);
};

export type Execute = Awaited<ReturnType<typeof getMysqlConnection>>["execute"];

export default getMysqlConnection;

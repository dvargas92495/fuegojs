import mysql from "mysql2/promise";
import { v4 } from "uuid";

const connectionMap: Record<string, mysql.Connection> = {};

const createConnection = (id = v4()) => {
  const DATABASE_URL_REGEX =
    /^mysql:\/\/([a-z0-9_]+):([^@]{4,32})@([a-z0-9.-]+):(\d{3,5})\/([a-z_]+)$/;
  const matches = DATABASE_URL_REGEX.exec(process.env.DATABASE_URL || "");
  if (!matches) return Promise.reject(`Error parsing Database URL`);
  return mysql
    .createConnection({
      host: matches[3],
      user: matches[1],
      port: Number(matches[4]),
      database: matches[5],
      password: matches[2],
    })
    .then((con) => (connectionMap[id] = con));
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

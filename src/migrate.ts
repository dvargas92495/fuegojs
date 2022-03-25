import mysql from "mysql2";
import { appPath, getDotEnvObject } from "./common";
import fs from "fs";
import crypto from "crypto";
import nodePath from "path";
import { v4 } from "uuid";
import esbuild from "esbuild";

const DATABASE_URL_REGEX =
  /^mysql:\/\/([a-z0-9_]+):(.{16})@([a-z0-9.-]+):(\d{3,5})\/([a-z_]+)$/;
const matches = DATABASE_URL_REGEX.exec(process.env.DATABASE_URL || "");

type MigrationArgs = {
  path?: string;
};

export type MigrationProps = {
  connection: mysql.Connection;
};

const migrate = ({
  path = "app/migrations",
}: MigrationArgs = {}): Promise<number> => {
  if (!matches) return Promise.reject("Failed to parse `DATABASE_URL`");
  const connection = mysql.createConnection({
    host: matches[3],
    user: matches[1],
    port: Number(matches[4]),
    database: matches[5],
    password: matches[2],
  });
  return new Promise((resolve) =>
    connection.execute(
      `CREATE TABLE IF NOT EXISTS _migrations (
        uuid           VARCHAR(36)  NOT NULL,
        migration_name VARCHAR(191) NOT NULL,
        started_at     DATETIME(3)  NOT NULL,
        finished_at    DATETIME(3)  NULL,
        checksum       VARCHAR(64)  NOT NULL,

        PRIMARY KEY (uuid)
    )`,
      resolve
    )
  )
    .then(
      () =>
        new Promise((resolve) =>
          connection.execute(`SELECT * FROM _migrations`, resolve)
        )
    )
    .then((results) => {
      const applied = (results || []) as {
        uuid: string;
        migration_name: string;
        started_at: string;
        finished_at: string;
        checksum: string;
      }[];
      const dir = appPath(path);
      const local = fs.existsSync(dir)
        ? fs.readdirSync(dir).map((f) => ({
            filename: f,
            migrationName: f.replace(/\.[t|j]s/, ""),
            checksum: crypto
              .createHash("md5")
              .update(fs.readFileSync(nodePath.join(dir, f)).toString())
              .digest("hex"),
            uuid: v4(),
          }))
        : [];
      applied.forEach((a, index) => {
        if (a.migration_name !== local[index].migrationName) {
          throw new Error(
            `Could not find applied migration ${a.migration_name} locally.`
          );
        }
        if (a.checksum !== local[index].checksum) {
          throw new Error(
            `Attempted to change applied migration ${a.migration_name} locally.`
          );
        }
      });
      const migrationsToRun = local
        .slice(applied.length)
        .map((m) => (props: MigrationProps) => {
          console.log(`Running migration ${m.migrationName}`);
          return new Promise((resolve) =>
            connection.execute(
              `INSERT INTO _migrations (uuid, migration_name, checksum, started_at) VALUES (?, ?, ?, ?)`,
              [m.uuid, m.migrationName, m.checksum, new Date()],
              resolve
            )
          )
            .then(() => {
              const outfile = appPath(
                nodePath.join(".cache", "migrations", `${m.migrationName}.js`)
              );
              return esbuild
                .build({
                  outfile,
                  entryPoints: [appPath(nodePath.join(dir, m.filename))],
                  platform: "node",
                  bundle: true,
                  define: getDotEnvObject(),
                  target: "node14",
                })
                .then(() => import(outfile));
            })
            .then(
              (mod) =>
                mod.migrate as (props: MigrationProps) => Promise<unknown>
            )
            .then((mig) =>
              mig(props).catch((e) => {
                console.error(`Failed to run migration ${m.migrationName}`);
                throw e;
              })
            )
            .then(
              () =>
                new Promise((resolve) =>
                  connection.execute(
                    `UPDATE _migrations SET finished_at = ? WHERE uuid = ?`,
                    [new Date(), m.uuid],
                    resolve
                  )
                )
            )
            .then(() => {
              console.log(`Finished running migration ${m.migrationName}`);
            });
        });
      if (!migrationsToRun.length) {
        console.log("No new migrations to run. Exiting...");
        return 0;
      }
      return migrationsToRun
        .reduce((p, c) => p.then(() => c({ connection })), Promise.resolve())
        .then(() => {
          connection.destroy();
          return 0;
        });
    });
};

export default migrate;

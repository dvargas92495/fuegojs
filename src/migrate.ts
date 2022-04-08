import mysql from "mysql2";
import { appPath, getDotEnvObject } from "./common";
import fs from "fs";
import crypto from "crypto";
import nodePath from "path";
import { v4 } from "uuid";
import { build as esbuild } from "esbuild";
import format from "date-fns/format";

const DATABASE_URL_REGEX =
  /^mysql:\/\/([a-z0-9_]+):(.{16})@([a-z0-9.-]+):(\d{3,5})\/([a-z_]+)$/;
const matches = DATABASE_URL_REGEX.exec(process.env.DATABASE_URL || "");

type MigrationArgs = {
  path?: string;
  revert?: boolean | string;
  generate?: string;
};

export type MigrationProps = {
  connection: mysql.Connection;
};

const MIGRATION_REGEX= /[a-z-]+/;

const migrate = ({
  path = "app/migrations",
  revert,
  generate,
}: MigrationArgs = {}): Promise<number> => {
  const dir = appPath(path);
  if (generate) {
    if (!MIGRATION_REGEX.test(generate)) return Promise.reject(`Invalid migration name. Expected regex: ${MIGRATION_REGEX.source}`);
    const filename = `${format(new Date(), 'yyyy-MM-dd-hh-mm')}-${generate}.ts`;
    fs.writeFileSync(nodePath.join(dir, filename), `import type { MigrationProps } from "fuegojs/dist/migrate";

export const migrate = (args: MigrationProps) => {
  return Promise.reject('Migration Not Implemented');
};

export const revert = (args: MigrationProps) => {
  return Promise.reject('Revert Not Implemented');
};
`)
    return Promise.resolve(0);
  }
  if (!matches) return Promise.reject("Failed to parse `DATABASE_URL`");
  const connection = mysql.createConnection({
    host: matches[3],
    user: matches[1],
    port: Number(matches[4]),
    database: matches[5],
    password: matches[2],
  });
  return new Promise((resolve, reject) =>
    connection.execute(
      `CREATE TABLE IF NOT EXISTS _migrations (
        uuid           VARCHAR(36)  NOT NULL,
        migration_name VARCHAR(191) NOT NULL,
        started_at     DATETIME(3)  NOT NULL,
        finished_at    DATETIME(3)  NULL,
        checksum       VARCHAR(64)  NOT NULL,

        PRIMARY KEY (uuid)
    )`,
      (err, result) => (err ? reject(err) : resolve(result))
    )
  )
    .then(
      () =>
        new Promise((resolve, reject) =>
          connection.execute(
            `SELECT * FROM _migrations ORDER BY started_at`,
            (err, result) => (err ? reject(err) : resolve(result))
          )
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
      const runMigrations = (
        migrationsToRun: ((props: MigrationProps) => Promise<void>)[]
      ) =>
        migrationsToRun
          .reduce((p, c) => p.then(() => c({ connection })), Promise.resolve())
          .then(() => {
            connection.destroy();
            return 0;
          });
      const reverting = !revert
        ? 0
        : typeof revert === "boolean"
        ? 1
        : Number(revert);
      if (reverting) {
        console.log("Reverting", reverting, "migrations...");
        if (reverting > applied.length) {
          return Promise.reject(
            `Attempted to revert ${reverting} migrations but only ${applied.length} are applied`
          );
        } else if (reverting < 0) {
          return Promise.reject(
            `Cannot revert a negative number of migrations.`
          );
        }
        const migrationsToRevert = applied
          .slice(-reverting)
          .reverse()
          .map((m) => () => {
            console.log(`reverting migration`, m.migration_name);
            return (
              new Promise((resolve, reject) =>
                connection.execute(
                  `DELETE FROM _migrations WHERE uuid = ?`,
                  [m.uuid],
                  (err, result) => (err ? reject(err) : resolve(result))
                )
              )
                /* TODO: disambiguate between the following cases:
                - failed migration
                - successful migration but mismatched checksum
                - successful migration with and without `revert` method
                
                .then(() => {
                const outfile = nodePath.join(outDir, `${m.migrationName}.js`);
                return esbuild({
                  outfile,
                  entryPoints: [appPath(nodePath.join(dir, m.filename))],
                  platform: "node",
                  bundle: true,
                  define: getDotEnvObject(),
                  target: "node14",
                }).then(() => import(outfile));
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
              )*/
                .then(() => {
                  console.log(
                    `Finished reverting migration ${m.migration_name}`
                  );
                })
            );
          });
        return runMigrations(migrationsToRevert);
      }
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
        if (!a.finished_at) {
          throw new Error(
            `Tried to run migration that had already started but failed. Please first remove migration record ${a.uuid} before attempting to apply migrations again.`
          );
        }
      });
      const outDir = appPath(nodePath.join(".cache", "migrations"));
      const migrationsToRun = local
        .slice(applied.length)
        .map((m) => (props: MigrationProps) => {
          console.log(`Running migration ${m.migrationName}`);
          return new Promise((resolve, reject) =>
            connection.execute(
              `INSERT INTO _migrations (uuid, migration_name, checksum, started_at) VALUES (?, ?, ?, ?)`,
              [m.uuid, m.migrationName, m.checksum, new Date()],
              (err, result) => (err ? reject(err) : resolve(result))
            )
          )
            .then(() => {
              const outfile = nodePath.join(outDir, `${m.migrationName}.js`);
              return esbuild({
                outfile,
                entryPoints: [appPath(nodePath.join(dir, m.filename))],
                platform: "node",
                bundle: true,
                define: getDotEnvObject(),
                target: "node14",
              }).then(() => import(outfile));
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
      } else if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
        console.log("Running ", migrationsToRun.length, "migrations...");
      }
      return runMigrations(migrationsToRun);
    });
};

export default migrate;

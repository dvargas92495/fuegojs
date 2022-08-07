import { Construct } from "constructs";
import {
  App,
  TerraformStack,
  RemoteBackend,
  TerraformHclModule,
  TerraformVariable,
} from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws";
import { GithubProvider, ActionsSecret } from "@cdktf/provider-github";
import { AwsServerlessBackend } from "@dvargas92495/aws-serverless-backend";
import { AwsClerk } from "@dvargas92495/aws-clerk";
import { AwsEmail } from "@dvargas92495/aws-email";
import { AwsWebsocket } from "@dvargas92495/aws-websocket";
import fs from "fs";
import getMysqlConnection from "./mysql";
import { ZodObject, ZodRawShape, ZodString } from "zod";
import { camelCase, snakeCase } from "change-case";
import pluralize from "pluralize";
import { PLAN_OUT_FILE, readDir } from "./common";
import path from "path";

const INVALID_COLUMN_NAMES = new Set(["key", "read"]);

type Column = {
  Field: string;
  Type: string;
  Null: "NO" | "YES";
  Key?: string;
  Extra?: string;
  Default?: string | null;
};

type Constraint = {
  COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
  REFERENCED_COLUMN_NAME: string | null;
  REFERENCED_TABLE_NAME: string | null;
};

const base = ({
  projectName,
  safeProjectName = projectName.replace(/\./g, "-"),
  clerkDnsId,
  emailDomain,
  variables = [],
  schema = {},
  callback,
}: {
  projectName: string;
  safeProjectName?: string;
  clerkDnsId?: string;
  emailDomain?: string;
  variables?: string[];
  schema?: Record<string, ZodObject<ZodRawShape>>;
  callback?: (this: Construct) => void;
}): void => {
  const fuegoArgs = Object.keys(process.env).filter((k) =>
    k.startsWith("FUEGO_ARGS_")
  );
  if (fuegoArgs.length) {
    console.log("Fuego Args:");
    fuegoArgs.forEach((f) => console.log("-", f, "=", process.env[f]));
  } else {
    console.log("No fuego args configured. Running...");
  }
  console.log("");

  if (!process.env.FUEGO_ARGS_SQL) {
    class MyStack extends TerraformStack {
      constructor(scope: Construct, name: string) {
        super(scope, name);

        const allVariables = ["mysql_password"]
          .concat(clerkDnsId ? ["clerk_api_key"] : [])
          .concat(variables);
        const aws_access_token = new TerraformVariable(
          this,
          "aws_access_token",
          {
            type: "string",
          }
        );

        const aws_secret_token = new TerraformVariable(
          this,
          "aws_secret_token",
          {
            type: "string",
          }
        );

        const secret = new TerraformVariable(this, "secret", {
          type: "string",
        });

        const aws = new AwsProvider(this, "AWS", {
          region: "us-east-1",
          accessKey: aws_access_token.value,
          secretKey: aws_secret_token.value,
        });

        new GithubProvider(this, "GITHUB", {
          token: process.env.GITHUB_TOKEN,
          owner: process.env.GITHUB_REPOSITORY_OWNER,
        });

        // TODO: figure out how to move this to json for type bindings
        // fails on: The child module requires an additional configuration for provider
        const staticSite = new TerraformHclModule(this, "aws_static_site", {
          source: "dvargas92495/static-site/aws",
          version: "3.6.7",
          providers: [
            {
              moduleAlias: "us-east-1",
              provider: aws,
            },
          ],
          variables: {
            origin_memory_size: 5120,
            origin_timeout: 20,
            domain: projectName,
            secret: secret.value,
          },
        });

        const allPaths = readDir("api").map((f) =>
          f.replace(/\.ts$/, "").replace(/^api\//, "")
        );

        const paths = allPaths.filter((f) => !/^ws/.test(f));
        const backend = new AwsServerlessBackend(
          this,
          "aws-serverless-backend",
          {
            apiName: safeProjectName,
            domain: projectName,
            paths,
          }
        );

        // TODO - should this be built into aws serverless backend?
        const wsPaths = allPaths
          .filter((p) => /^ws/.test(p))
          .map((p) => p.replace(/^ws\//, ""));
        if (wsPaths.length) {
          new AwsWebsocket(this, "aws-websocket", {
            name: safeProjectName,
            paths: wsPaths,
          });
        }

        if (clerkDnsId) {
          new AwsClerk(this, "aws_clerk", {
            zoneId: staticSite.get("route53_zone_id"),
            clerkId: clerkDnsId,
          });
        }

        if (emailDomain) {
          new AwsEmail(this, "aws_email", {
            zoneId: staticSite.get("route53_zone_id"),
            domain: emailDomain,
          });
        }

        new ActionsSecret(this, "deploy_aws_access_key", {
          repository: projectName,
          secretName: "DEPLOY_AWS_ACCESS_KEY",
          plaintextValue: staticSite.get("deploy-id"),
        });

        new ActionsSecret(this, "deploy_aws_access_secret", {
          repository: projectName,
          secretName: "DEPLOY_AWS_ACCESS_SECRET",
          plaintextValue: staticSite.get("deploy-secret"),
        });

        new ActionsSecret(this, "lambda_aws_access_key", {
          repository: projectName,
          secretName: "LAMBDA_AWS_ACCESS_KEY",
          plaintextValue: backend.accessKeyOutput,
        });

        new ActionsSecret(this, "lambda_aws_access_secret", {
          repository: projectName,
          secretName: "LAMBDA_AWS_ACCESS_SECRET",
          plaintextValue: backend.secretKeyOutput,
        });

        new ActionsSecret(this, "cloudfront_distribution_id", {
          repository: projectName,
          secretName: "CLOUDFRONT_DISTRIBUTION_ID",
          plaintextValue: staticSite.get("cloudfront_distribution_id"),
        });
        allVariables.forEach((v) => {
          const tf_secret = new TerraformVariable(this, v, {
            type: "string",
          });
          new ActionsSecret(this, `${v}_secret`, {
            repository: projectName,
            secretName: v.toUpperCase(),
            plaintextValue: tf_secret.value,
          });
        });

        callback?.bind(this)();
      }
    }

    const app = new App();
    const stack = new MyStack(app, safeProjectName);
    new RemoteBackend(stack, {
      hostname: "app.terraform.io",
      // TODO - parameterize the TF organization
      organization: "VargasArts",
      workspaces: {
        name: safeProjectName,
      },
    });

    app.synth();
  }

  getMysqlConnection().then(async (cxn) => {
    const actualTableResults = await cxn
      .execute(`show tables`)
      .then((r) => r as Record<string, string>[]);
    const actualTables = actualTableResults.map(
      (t) => t[`Tables_in_${snakeCase(safeProjectName)}`]
    );
    if (actualTables.some((t) => !t)) {
      throw new Error(
        `Detected some unexpected results from \`show tables\`. Actual: ${JSON.stringify(
          actualTableResults,
          null,
          4
        )}`
      );
    }
    const tablesToDelete: string[] = [];
    const tablesToCreate: Record<string, ZodObject<ZodRawShape>> = {};
    const tablesToUpdate: Record<string, ZodObject<ZodRawShape>> = {};
    const expectedTables = Object.keys(schema);
    actualTables
      .map((t) => {
        return camelCase(t);
      })
      .filter((t) => t !== "migrations")
      .map((t) => pluralize(t, 1))
      .forEach((t) => {
        if (!expectedTables.includes(t)) {
          tablesToDelete.push(t);
        }
      });
    const actualSet = new Set(actualTables);
    expectedTables.forEach((t) => {
      const key = pluralize(snakeCase(t));
      if (actualSet.has(key)) {
        tablesToUpdate[key] = schema[t];
      } else {
        tablesToCreate[key] = schema[t];
      }
    });

    const outputColumn = (c: Column) =>
      `${c.Field}  ${c.Type}  ${c.Null === "YES" ? "NULL" : "NOT NULL"}${
        c.Default === null ? "" : ` DEFAULT ${c.Default}`
      }`;

    const getTableInfo = (s: ZodObject<ZodRawShape>) => {
      const shapeKeys = Object.keys(s.shape);
      const primary = shapeKeys.find((col) =>
        /primary/i.test(s.shape[col].description || "")
      );

      const uniques = shapeKeys
        .filter((col) => /unique/i.test(s.shape[col].description || ""))
        .map((e) => snakeCase(e));

      const foreigns = Object.keys(s.shape)
        .filter((col) => /foreign/i.test(s.shape[col].description || ""))
        .map((e) => snakeCase(e))
        .map((key) => {
          const parts = key.split("_");
          return {
            key,
            table: pluralize(parts.slice(0, -1).join("_")),
            ref: parts.slice(-1)[0],
          };
        });

      return {
        constraints: {
          primary: primary && snakeCase(primary),
          uniques,
          foreigns,
        },
        columns: shapeKeys.map((columnName) => {
          const shape = s.shape[columnName];
          if (INVALID_COLUMN_NAMES.has(columnName)) {
            throw new Error(`\`${columnName}\` is an invalid column name`);
          }
          const def = shape._def;
          const nullable = shape.isOptional() || shape.isNullable();
          return {
            Field: snakeCase(columnName),
            Type:
              def.typeName === "ZodString"
                ? `VARCHAR(${
                    (shape as ZodString).isUUID
                      ? 36
                      : (shape as ZodString).maxLength || 128
                  })`
                : def.typeName === "ZodNumber"
                ? (shape as ZodString).maxLength
                  ? `TINYINT(${Math.ceil(
                      Math.log2((shape as ZodString).maxLength || 1)
                    )}`
                  : "INT"
                : def.typeName === "ZodDate"
                ? "DATETIME(3)"
                : def.typeName === "ZodBoolean"
                ? "TINYINT(1)"
                : def.typeName,
            Null: nullable ? ("YES" as const) : ("NO" as const),
            Key: "",
            Extra: "",
            Default: nullable
              ? def.typeName === "ZodString"
                ? ""
                : def.typeName === "ZodNumber" || def.typeName === "ZodBoolean"
                ? "0"
                : null
              : null,
          };
        }),
      };
    };

    const updates = await Promise.all(
      Object.keys(tablesToUpdate).map((table) =>
        Promise.all([
          // interpolating is incorrect sql for show columns
          cxn.execute(`SHOW COLUMNS FROM ${table}`),
          cxn
            .execute(
              `select COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_COLUMN_NAME, REFERENCED_TABLE_NAME 
          from information_schema.KEY_COLUMN_USAGE 
          where TABLE_NAME = ?`,
              [table]
            )
            .catch(() => {
              console.log("cant query information_schema");
              return [];
            }),
        ]).then(([cols, cons]) => {
          const actualColumns = cols as Column[];
          const actualConstraints = cons as Constraint[];

          const colsToDelete: string[] = [];
          const colsToAdd: string[] = [];
          const colsToUpdate: string[] = [];
          const consToDelete: string[] = []; // TODO
          const consToAdd: string[] = [];

          const expectedColumns = Object.keys(tablesToUpdate[table].shape);
          actualColumns.forEach((c) => {
            if (!expectedColumns.includes(camelCase(c.Field))) {
              colsToDelete.push(c.Field);
            }
          });

          const actualColumnSet = new Set(actualColumns.map((c) => c.Field));
          const expectedColumnInfo = getTableInfo(tablesToUpdate[table]);
          const actualTypeByField = Object.fromEntries(
            actualColumns.map(({ Field, ...c }) => [Field, c])
          );
          const expectedTypeByField = Object.fromEntries(
            expectedColumnInfo.columns.map(({ Field, ...c }) => [
              snakeCase(Field),
              c,
            ])
          );
          expectedColumns
            .map((e) => snakeCase(e))
            .forEach((c) => {
              if (actualColumnSet.has(c)) {
                colsToUpdate.push(c);
              } else {
                colsToAdd.push(c);
              }
            });

          // TODO UNIQUES
          const uniqsToDrop = new Set();
          actualConstraints.forEach((con) => {
            if (con.REFERENCED_COLUMN_NAME !== null) {
              if (
                !expectedColumnInfo.constraints.foreigns.some(
                  (f) =>
                    con.COLUMN_NAME === f.key &&
                    con.CONSTRAINT_NAME ===
                      `FK_${table}_${f.key}_${f.table}_${f.ref}` &&
                    con.REFERENCED_COLUMN_NAME === f.ref &&
                    con.REFERENCED_TABLE_NAME === f.table
                )
              ) {
                consToDelete.push(`FOREIGN KEY ${con.CONSTRAINT_NAME}`);
              }
            } else if (con.CONSTRAINT_NAME === "PRIMARY") {
              if (expectedColumnInfo.constraints.primary !== con.COLUMN_NAME) {
                consToDelete.push(`PRIMARY KEY`);
              }
            } else {
              // for now, we assume a unique index, even though regular indices are a thing
              if (
                `UC_${expectedColumnInfo.constraints.uniques.join("_")}` !==
                  con.CONSTRAINT_NAME &&
                !uniqsToDrop.has(con.CONSTRAINT_NAME)
              ) {
                consToDelete.push(`INDEX ${con.CONSTRAINT_NAME}`);
                // each key in the UQ will have its own entry
                uniqsToDrop.add(con.CONSTRAINT_NAME);
              }
            }
          });

          expectedColumnInfo.constraints.foreigns.forEach((f) => {
            if (
              !actualConstraints.some(
                (con) =>
                  con.COLUMN_NAME === f.key &&
                  con.CONSTRAINT_NAME ===
                    `FK_${table}_${f.key}_${f.table}_${f.ref}` &&
                  con.REFERENCED_COLUMN_NAME === f.ref &&
                  con.REFERENCED_TABLE_NAME === f.table
              )
            ) {
              consToAdd.push(
                `FOREIGN KEY FK_${table}_${f.key}_${f.table}_${f.ref} (${f.key}) REFERENCES ${f.table}(${f.ref})`
              );
            }
          });
          if (
            expectedColumnInfo.constraints.primary &&
            !actualConstraints.some(
              (con) =>
                con.COLUMN_NAME === expectedColumnInfo.constraints.primary &&
                con.CONSTRAINT_NAME === "PRIMARY"
            )
          ) {
            consToAdd.push(
              `PRIMARY KEY (${expectedColumnInfo.constraints.primary})`
            );
          }
          if (
            expectedColumnInfo.constraints.uniques.length &&
            !actualConstraints.some(
              (con) =>
                `UC_${expectedColumnInfo.constraints.uniques.join("_")}` ===
                con.CONSTRAINT_NAME
            )
          ) {
            consToAdd.push(
              `CONSTRAINT UC_${expectedColumnInfo.constraints.uniques.join(
                "_"
              )} UNIQUE (${expectedColumnInfo.constraints.uniques.join(",")})`
            );
          }
          return colsToDelete
            .map((c) => `ALTER TABLE ${table} DROP COLUMN ${c}`)
            .concat(
              colsToAdd.map(
                (c) =>
                  `ALTER TABLE ${table} ADD ${outputColumn({
                    Field: c,
                    ...expectedTypeByField[c],
                  })}`
              )
            )
            .concat(
              colsToUpdate
                .filter(
                  (c) =>
                    expectedTypeByField[c].Type !==
                      actualTypeByField[c].Type.toUpperCase() ||
                    expectedTypeByField[c].Null !== actualTypeByField[c].Null ||
                    expectedTypeByField[c].Default !==
                      actualTypeByField[c].Default
                )
                .map(
                  (c) =>
                    `ALTER TABLE ${table} MODIFY ${outputColumn({
                      Field: c,
                      ...expectedTypeByField[c],
                    })}`
                )
            )
            .concat(consToDelete.map((c) => `ALTER TABLE ${table} DROP ${c}`))
            .concat(consToAdd.map((c) => `ALTER TABLE ${table} ADD ${c}`));
        })
      )
    ).then((cols) => cols.flat());

    console.log("SQL PLAN:");
    console.log("");

    const queries = tablesToDelete
      .map((s) => `DROP TABLE ${pluralize(snakeCase(s))}`)
      .concat(
        Object.entries(tablesToCreate).map(([k, s]) => {
          const {
            columns,
            constraints: { primary, uniques, foreigns },
          } = getTableInfo(s);
          return `CREATE TABLE IF NOT EXISTS ${k} (
${columns.map((c) => `  ${outputColumn(c)},`).join("\n")}
  
  ${[
    primary && `PRIMARY KEY (${primary})`,
    uniques.length &&
      `CONSTRAINT UC_${uniques.join("_")} UNIQUE (${uniques.join(",")})`,
    ...foreigns.map(
      ({ ref, table, key }) =>
        `FOREIGN KEY FK_${k}_${key}_${table}_${ref} (${key}) REFERENCES ${table}(${ref})`
    ),
  ]
    .filter((c) => !!c)
    .join(",\n  ")}
)`;
        })
      )
      .concat(updates);
    if (queries.length) {
      queries.forEach((q) => console.log(">", q, "\n\n"));
      console.log("");
      console.log("Ready to apply...");
    } else {
      console.log("No migrations to apply.");
    }
    if (!fs.existsSync(path.dirname(PLAN_OUT_FILE)))
      fs.mkdirSync(path.dirname(PLAN_OUT_FILE));
    fs.writeFileSync(PLAN_OUT_FILE, queries.join(";\n\n"));

    cxn.destroy();
  });
};

export default base;

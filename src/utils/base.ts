import { Construct } from "constructs";
import { App, TerraformStack, RemoteBackend, TerraformVariable } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { CloudfrontCachePolicy } from "@cdktf/provider-aws/lib/cloudfront-cache-policy";
import { GithubProvider } from "@cdktf/provider-github/lib/provider";
import { ActionsSecret } from "@cdktf/provider-github/lib/actions-secret";
import { AwsServerlessBackend } from "@dvargas92495/aws-serverless-backend";
import { AwsClerk } from "@dvargas92495/aws-clerk";
import { AwsEmail } from "@dvargas92495/aws-email";
import { AwsWebsocket } from "@dvargas92495/aws-websocket";
import { AwsStaticSite } from "@dvargas92495/aws-static-site";
import fs from "fs";
import getMysqlConnection from "./mysql";
import { z, ZodObject, ZodRawShape, ZodString, ZodNumber } from "zod";
import { camelCase, snakeCase } from "change-case";
import pluralize from "pluralize";
import { PLAN_OUT_FILE, readDir } from "../internal/common";
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

type Index = {
  Table: string;
  Non_unique: 0 | 1;
  Key_name: string;
  Seq_in_index: 1;
  Column_name: string;
};

const safeJsonParse = (s = "{}") => {
  try {
    return JSON.parse(s || "{}");
  } catch (e) {
    return {};
  }
};

// https://dev.mysql.com/doc/refman/8.0/en/integer-types.html
const getIntegerType = ({ maxValue, minValue }: ZodNumber) => {
  if (typeof maxValue === "undefined" || maxValue === null) {
    return "INT";
  }
  if (minValue === 0) {
    if (maxValue <= Math.pow(2, 8) - 1) {
      return "TINYINT UNSIGNED";
    } else if (maxValue <= Math.pow(2, 16) - 1) {
      return "SMALLINT UNSIGNED";
    } else if (maxValue <= Math.pow(2, 24) - 1) {
      return "MEDIUMINT UNSIGNED";
    } else if (maxValue <= Math.pow(2, 32) - 1) {
      return "INT UNSIGNED";
    } else if (maxValue <= Math.pow(2, 64) - 1) {
      return "BIGINT UNSIGNED";
    } else {
      throw new Error(
        `max value is too large: ${maxValue}. Consider multiple columns`
      );
    }
  } else {
    if (maxValue <= Math.pow(2, 7) - 1) {
      return "TINYINT";
    } else if (maxValue <= Math.pow(2, 15) - 1) {
      return "SMALLINT";
    } else if (maxValue <= Math.pow(2, 23) - 1) {
      return "MEDIUMINT";
    } else if (maxValue <= Math.pow(2, 31) - 1) {
      return "INT";
    } else if (maxValue <= Math.pow(2, 63) - 1) {
      return "BIGINT";
    } else {
      throw new Error(
        `max value is too large: ${maxValue}. Consider multiple columns`
      );
    }
  }
};

const base = async ({
  projectName,
  safeProjectName = projectName.replace(/\./g, "-"),
  clerkDnsId,
  // @deprecated
  emailDomain,
  emailSettings = "OFF",
  variables = [],
  schema,
  backendProps = {},
  organization = "VargasArts",
  callback,
}: {
  projectName: string;
  safeProjectName?: string;
  clerkDnsId?: string;
  emailDomain?: string;
  emailSettings?: "OFF" | "OUTBOUND" | "ALL";
  variables?: string[];
  schema?: Record<string, ZodObject<ZodRawShape>>;
  backendProps?: {
    sizes?: Record<string, string>;
  };
  organization?: string;
  callback?: (this: Construct) => Promise<void>;
}): Promise<void> => {
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

        const allVariables = ["database_url"]
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

        const cachePolicy = new CloudfrontCachePolicy(this, "cache_policy", {
          name: `${safeProjectName}-cache-policy`,
          comment: `Caching for ${projectName}`,
          defaultTtl: 1,
          maxTtl: 31536000,
          minTtl: 1,
          parametersInCacheKeyAndForwardedToOrigin: {
            cookiesConfig: { cookieBehavior: "none" },
            headersConfig: { headerBehavior: "none" },
            queryStringsConfig: { queryStringBehavior: "all" },
          },
        });

        const staticSite = new AwsStaticSite(this, "aws_static_site", {
          providers: [
            {
              moduleAlias: "us-east-1",
              provider: aws,
            },
          ],
          originMemorySize: 5120,
          originTimeout: 20,
          domain: projectName,
          secret: secret.value,
          cachePolicyId: cachePolicy.id,
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
            sizes: backendProps?.sizes,
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
            zoneId: staticSite.route53ZoneIdOutput,
            clerkId: clerkDnsId,
          });
        }

        if (emailSettings !== "OFF" || emailDomain) {
          new AwsEmail(this, "aws_email", {
            zoneId: staticSite.route53ZoneIdOutput,
            domain: emailDomain || projectName,
            inbound: emailSettings === "ALL",
          });
        }

        new ActionsSecret(this, "tf_aws_access_key", {
          repository: projectName,
          secretName: "TF_AWS_ACCESS_KEY",
          plaintextValue: aws_access_token.value,
        });

        new ActionsSecret(this, "tf_aws_access_secret", {
          repository: projectName,
          secretName: "TF_AWS_ACCESS_SECRET",
          plaintextValue: aws_secret_token.value,
        });

        new ActionsSecret(this, "deploy_aws_access_key", {
          repository: projectName,
          secretName: "DEPLOY_AWS_ACCESS_KEY",
          plaintextValue: staticSite.deployIdOutput,
        });

        new ActionsSecret(this, "deploy_aws_access_secret", {
          repository: projectName,
          secretName: "DEPLOY_AWS_ACCESS_SECRET",
          plaintextValue: staticSite.deploySecretOutput,
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
          plaintextValue: staticSite.cloudfrontDistributionIdOutput,
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
      }
    }

    const app = new App();
    const stack = new MyStack(app, safeProjectName);
    await callback?.bind(stack)();
    new RemoteBackend(stack, {
      hostname: "app.terraform.io",
      organization,
      workspaces: {
        name: safeProjectName,
      },
    });

    app.synth();
  }

  if (schema) {
    const cxn = await getMysqlConnection();
    const actualTableResults = await cxn
      .execute(`show tables`)
      .then(([r]) => r as Record<string, string>[]);
    const dbname = snakeCase(safeProjectName);
    const actualTables = actualTableResults.map(
      (t) => t[`Tables_in_${dbname}`]
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
      .filter((t) => !/^_/.test(t))
      .map((t) => {
        return camelCase(t);
      })
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
        c.Default === null ? "" : ` DEFAULT ${c.Default || `""`}`
      }`;

    const getTableInfo = (s: ZodObject<ZodRawShape>) => {
      const shapeKeys = Object.keys(s.shape);
      const primary = shapeKeys.find((col) =>
        /primary/i.test(s.shape[col].description || "")
      );

      const tableMetadata = z
        .object({
          uniques: z.string().array().array().optional().default([]),
        })
        .parse(safeJsonParse(s.description));

      const uniques = shapeKeys
        .filter((col) => /^unique$/i.test(s.shape[col].description || ""))
        .map((e) => [snakeCase(e)])
        .concat(tableMetadata.uniques);

      const indices = shapeKeys
        .filter((col) => /^index$/i.test(s.shape[col].description || ""))
        .map((e) => [snakeCase(e)]);

      return {
        constraints: {
          primary: primary && snakeCase(primary),
          uniques,
          indices,
        },
        columns: shapeKeys.map((columnName) => {
          const shape = s.shape[columnName];
          if (INVALID_COLUMN_NAMES.has(columnName)) {
            throw new Error(`\`${columnName}\` is an invalid column name`);
          }
          const def = shape._def;
          const nullable = shape.isOptional() || shape.isNullable();
          const typeName = nullable
            ? def.innerType._def.typeName
            : def.typeName;
          return {
            Field: snakeCase(columnName),
            Type:
              typeName === "ZodString"
                ? `VARCHAR(${
                    (shape as ZodString).isUUID
                      ? 36
                      : (shape as ZodString).maxLength || 128
                  })`
                : typeName === "ZodNumber"
                ? getIntegerType(shape as ZodNumber)
                : typeName === "ZodDate"
                ? "DATETIME"
                : typeName === "ZodBoolean"
                ? "TINYINT(1)"
                : typeName === "ZodObject"
                ? "JSON"
                : typeName,
            Null: nullable ? ("YES" as const) : ("NO" as const),
            Key: "",
            Extra: "",
            Default: nullable
              ? null
              : typeName === "ZodString"
              ? ""
              : typeName === "ZodNumber" || typeName === "ZodBoolean"
              ? "0"
              : typeName === "ZodDate"
              ? "CURRENT_TIMESTAMP"
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
          cxn.execute(`SHOW INDEXES FROM ${table}`),
        ]).then(([[cols], [inds]]) => {
          const actualColumns = cols as Column[];
          const actualIndices = inds as Index[];

          const colsToDelete: string[] = [];
          const colsToAdd: string[] = [];
          const colsToUpdate: string[] = [];
          const consToDelete: string[] = [];
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

          const indsToDrop = new Set();
          const expectedInds = new Set(
            expectedColumnInfo.constraints.uniques
              .map((u) => `UC_${u.join("_")}`)
              .concat(
                expectedColumnInfo.constraints.indices.map(
                  (i) => `IX_${i.join("_")}`
                )
              )
          );
          actualIndices.forEach((con) => {
            if (con.Key_name === "PRIMARY") {
              if (expectedColumnInfo.constraints.primary !== con.Column_name) {
                consToDelete.push(`PRIMARY KEY`);
              }
            } else {
              if (
                !expectedInds.has(con.Key_name) &&
                !indsToDrop.has(con.Key_name)
              ) {
                consToDelete.push(`INDEX ${con.Key_name}`);
                indsToDrop.add(con.Key_name);
              }
            }
          });

          if (
            expectedColumnInfo.constraints.primary &&
            !actualIndices.some(
              (con) =>
                con.Column_name === expectedColumnInfo.constraints.primary &&
                con.Key_name === "PRIMARY"
            )
          ) {
            consToAdd.push(
              `PRIMARY KEY (${expectedColumnInfo.constraints.primary})`
            );
          }
          expectedColumnInfo.constraints.uniques.forEach((uc) => {
            if (
              !actualIndices.some(
                (con) => `UC_${uc.join("_")}` === con.Key_name
              )
            ) {
              consToAdd.push(
                `CREATE UNIQUE INDEX IX_${uc.join("_")} on ${table} (${uc.join(
                  ","
                )})`
              );
            }
          });
          expectedColumnInfo.constraints.indices.forEach((ix) => {
            if (
              !actualIndices.some(
                (con) => `IX_${ix.join("_")}` === con.Key_name
              )
            ) {
              consToAdd.push(
                `CREATE INDEX IX_${ix.join("_")} on ${table} (${ix.join(",")})`
              );
            }
          });
          return consToDelete
            .sort()
            .map((c) => `ALTER TABLE ${table} DROP ${c}`)
            .concat(
              colsToDelete.map((c) => `ALTER TABLE ${table} DROP COLUMN ${c}`)
            )
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
                    // TODO - need to compare this better - length field is actual for all fields, but not expected for ints
                    expectedTypeByField[c].Type.replace(
                      /\(\d+\)/,
                      ""
                    ).toUpperCase() !==
                      actualTypeByField[c].Type.replace(
                        /\(\d+\)/,
                        ""
                      ).toUpperCase() ||
                    expectedTypeByField[c].Null !== actualTypeByField[c].Null ||
                    expectedTypeByField[c].Default !==
                      actualTypeByField[c].Default
                )
                .map((c) => {
                  if (process.env.DEBUG)
                    console.log(
                      "Column diff expected:",
                      JSON.stringify(expectedTypeByField[c], null, 4),
                      "actual:",
                      JSON.stringify(actualTypeByField[c], null, 4)
                    );
                  return `ALTER TABLE ${table} MODIFY ${outputColumn({
                    Field: c,
                    ...expectedTypeByField[c],
                  })}`;
                })
            )
            .concat(consToAdd);
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
            constraints: { primary, uniques, indices },
          } = getTableInfo(s);
          return `CREATE TABLE IF NOT EXISTS ${k} (
${columns.map((c) => `  ${outputColumn(c)},`).join("\n")}

  ${[
    primary && `PRIMARY KEY (${primary})`,
    ...uniques.map((uc) => `UNIQUE INDEX UC_${uc.join("_")} (${uc.join(",")})`),
    ...indices.map((uc) => `INDEX IX_${uc.join("_")} (${uc.join(",")})`),
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
  }
};

export default base;

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
import { AwsServerlessBackend } from ".gen/modules/aws-serverless-backend";
import { AwsClerk } from ".gen/modules/aws-clerk";
import { AwsEmail } from ".gen/modules/aws-email";
import { AwsWebsocket } from ".gen/modules/aws-websocket";
import fs from "fs";
import getMysqlConnection from "./mysql";
import { ZodObject, ZodRawShape, ZodString } from "zod";
import { camelCase, snakeCase } from "change-case";
import pluralize from "pluralize";
import { PLAN_OUT_FILE, readDir } from "./common";
import path from "path";

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
  class MyStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
      super(scope, name);

      const allVariables = [
        "mysql_password",
        "stripe_public",
        "stripe_secret",
        "stripe_webhook_secret",
        "terraform_cloud_token",
      ]
        .concat(clerkDnsId ? ["clerk_api_key"] : [])
        .concat(variables);
      const aws_access_token = new TerraformVariable(this, "aws_access_token", {
        type: "string",
      });

      const aws_secret_token = new TerraformVariable(this, "aws_secret_token", {
        type: "string",
      });

      const github_token = new TerraformVariable(this, "github_token", {
        type: "string",
      });

      const secret = new TerraformVariable(this, "secret", {
        type: "string",
      });

      const aws = new AwsProvider(this, "AWS", {
        region: "us-east-1",
        accessKey: aws_access_token.value,
        secretKey: aws_secret_token.value,
      });

      new GithubProvider(this, "GITHUB", {
        owner: "dvargas92495",
        token: github_token.value,
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

      const paths = readDir("api")
        .map((f) => f.replace(/\.ts$/, "").replace(/^api\//, ""))
        .filter((f) => !/^ws/.test(f));
      const backend = new AwsServerlessBackend(this, "aws-serverless-backend", {
        apiName: safeProjectName,
        domain: projectName,
        paths,
      });

      // TODO - should this be built into aws serverless backend?
      const wsPaths = paths
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
        new AwsEmail(this, "aws_clerk", {
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
    organization: "VargasArts",
    workspaces: {
      name: safeProjectName,
    },
  });

  app.synth();

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

    await Promise.all(
      Object.keys(tablesToUpdate).map((table) =>
        cxn.execute(`SHOW COLUMNS FROM ${table}`).then((res) => {
          const cols = res as {
            Field: string;
            Type: string;
            Null: "NO" | "YES";
            Key?: string;
            Extra?: string;
          }[];
          // cols to delete
          // cols to add
          // cols to update
          return cols.filter(() => false).map(() => "UPDATE");
        })
      )
    ).then((cols) => cols.flat());

    console.log("SQL PLAN:");
    console.log("");
    const queries = tablesToDelete
      .map((s) => `DROP TABLE ${s}`)
      .concat(
        Object.entries(tablesToCreate).map(([k, s]) => {
          const constraints: string[] = [];
          const shapeKeys = Object.keys(s.shape);
          const primary = shapeKeys.find((col) =>
            /primary/i.test(s.shape[col].description || "")
          );
          if (primary) constraints.push(`PRIMARY KEY (${snakeCase(primary)})`);

          const uniques = shapeKeys
            .filter((col) => /unique/i.test(s.shape[col].description || ""))
            .map((e) => snakeCase(e));
          if (uniques.length)
            constraints.push(
              `CONSTRAINT UC_${uniques.join("_")} UNIQUE (${uniques.join(",")})`
            );

          Object.keys(s.shape)
            .filter((col) => /foreign/i.test(s.shape[col].description || ""))
            .map((e) => snakeCase(e))
            .map((key) => {
              const parts = key.split("_");
              return {
                key,
                table: pluralize(parts.slice(0, -1).join("_")),
                ref: parts.slice(-1)[0],
              };
            })
            .forEach(({ key, table, ref }) =>
              constraints.push(
                `FOREIGN KEY (${key}) REFERENCES ${table}(${ref})`
              )
            );

          return `CREATE TABLE IF NOT EXISTS ${k} (
  ${shapeKeys
    .map((columnName) => {
      const shape = s.shape[columnName];
      if (columnName === "key") {
        throw new Error(`\`${columnName}\` is an invalid column name`);
      }
      const def = shape._def;
      return `  ${snakeCase(columnName)}   ${
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
          : def.typeName
      } ${shape.isOptional() || shape.isNullable() ? "" : "NOT "}NULL,\n`;
    })
    .join("  ")}

  ${constraints.join(",\n  ")}
)`;
        })
      )
      .concat();
    if (queries.length) {
      queries.forEach((q) => console.log(">", q));
      console.log("");
      console.log("Ready to apply...");
    } else {
      console.log("No migrations to apply.");
    }
    if (!fs.existsSync(path.dirname(PLAN_OUT_FILE)))
      fs.mkdirSync(path.dirname(PLAN_OUT_FILE));
    fs.writeFileSync(PLAN_OUT_FILE, queries.join("\n\n"));

    cxn.destroy();
  });
};

export default base;

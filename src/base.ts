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
import fs from "fs";

const base = ({
  projectName,
  safeProjectName,
  clerkDnsId,
  emailDomain,
  variables = [],
  callback,
}: {
  projectName: string;
  safeProjectName: string;
  clerkDnsId?: string;
  emailDomain?: string;
  variables?: string[];
  callback?: (this: Construct) => void;
}): void => {
  class MyStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
      super(scope, name);

      const allVariables = [
        "mysql_password",
        "clerk_api_key",
        "stripe_public",
        "stripe_secret",
        "stripe_webhook_secret",
      ].concat(variables);
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

      const paths = fs
        .readdirSync("api", { withFileTypes: true })
        .flatMap((f) =>
          f.isDirectory()
            ? fs.readdirSync(`api/${f.name}`).map((ff) => `${f.name}/${ff}`)
            : [f.name]
        )
        .map((f) => f.replace(/\.ts$/, ""));
      const backend = new AwsServerlessBackend(this, "aws-serverless-backend", {
        apiName: safeProjectName,
        domain: projectName,
        paths,
      });

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
};

export default base;

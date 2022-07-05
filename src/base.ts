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
  callback,
}: {
  projectName: string;
  safeProjectName: string;
  clerkDnsId?: string;
  emailDomain?: string;
  callback?: (this: Construct) => void;
}): void => {
  class MyStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
      super(scope, name);

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

      const clerk_api_key = new TerraformVariable(this, "clerk_api_key", {
        type: "string",
      });

      const mysql_password = new TerraformVariable(this, "mysql_password", {
        type: "string",
      });

      const stripe_public = new TerraformVariable(this, "stripe_public", {
        type: "string",
      });

      const stripe_secret = new TerraformVariable(this, "stripe_secret", {
        type: "string",
      });

      const stripe_webhook_secret = new TerraformVariable(
        this,
        "stripe_webhook_secret",
        {
          type: "string",
        }
      );

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
          clerkId: clerkDnsId,
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

      new ActionsSecret(this, "mysql_password_secret", {
        repository: projectName,
        secretName: "MYSQL_PASSWORD",
        plaintextValue: mysql_password.value,
      });
      new ActionsSecret(this, "clerk_api_key_secret", {
        repository: projectName,
        secretName: "CLERK_API_KEY",
        plaintextValue: clerk_api_key.value,
      });
      new ActionsSecret(this, "cloudfront_distribution_id", {
        repository: projectName,
        secretName: "CLOUDFRONT_DISTRIBUTION_ID",
        plaintextValue: staticSite.get("cloudfront_distribution_id"),
      });
      new ActionsSecret(this, "stripe_public_secret", {
        repository: projectName,
        secretName: "STRIPE_PUBLIC_KEY",
        plaintextValue: stripe_public.value,
      });
      new ActionsSecret(this, "stripe_secret_secret", {
        repository: projectName,
        secretName: "STRIPE_SECRET_KEY",
        plaintextValue: stripe_secret.value,
      });
      new ActionsSecret(this, "stripe_webhook_secret_secret", {
        repository: projectName,
        secretName: "STRIPE_WEBHOOK_SECRET",
        plaintextValue: stripe_webhook_secret.value,
      });

      callback?.bind(this)();
    }
  }

  const app = new App();
  const stack = new MyStack(app, projectName);
  new RemoteBackend(stack, {
    hostname: "app.terraform.io",
    organization: "VargasArts",
    workspaces: {
      name: projectName,
    },
  });

  app.synth();
};

export default base;

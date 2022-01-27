import AWS from "aws-sdk";
import fs from "fs";
import mime from "mime-types";
import { readDir, FE_OUT_DIR, appPath } from "./common";
import path from "path";
import archiver from "archiver";
import crypto from "crypto";

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();
const lambda = new AWS.Lambda();

const getDistributionIdByDomain = async (domain: string) => {
  let finished = false;
  let props = {};
  while (!finished) {
    const { DistributionList: { IsTruncated, NextMarker, Items = [] } = {} } =
      await cloudfront.listDistributions(props).promise();
    const distribution = Items.find((i) =>
      (i.Aliases.Items || []).includes(domain)
    );
    if (distribution) {
      return distribution.Id;
    }
    finished = !IsTruncated;
    props = { Marker: NextMarker };
  }

  return null;
};

const waitForCloudfrontInvalidation = (props: {
  trial?: number;
  DistributionId: string;
  resolve: (s: string) => void;
  Id: string;
}) => {
  const { trial = 0, resolve, ...args } = props;
  cloudfront
    .getInvalidation(args)
    .promise()
    .then((r) => r.Invalidation?.Status)
    .then((status) => {
      if (status === "Completed") {
        resolve("Done!");
      } else if (trial === 60) {
        resolve("Ran out of time waiting for cloudfront...");
      } else {
        setTimeout(
          () =>
            waitForCloudfrontInvalidation({
              ...args,
              trial: trial + 1,
              resolve,
            }),
          1000
        );
      }
    });
};

const waitForLambda = ({
  trial = 0,
  Qualifier,
  FunctionName,
}: {
  trial?: number;
  Qualifier: string;
  FunctionName: string;
}): Promise<string> => {
  return lambda
    .getFunction({ FunctionName, Qualifier })
    .promise()
    .then((r) => r.Configuration?.State)
    .then((status) => {
      if (status === "Active") {
        return "Done, Lambda is Active!";
      } else if (trial === 60) {
        return "Ran out of time waiting for lambda...";
      } else {
        console.log(
          `Lambda had state ${status} on trial ${trial}. Trying again...`
        );
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                waitForLambda({ trial: trial + 1, Qualifier, FunctionName })
              ),
            6000
          )
        );
      }
    });
};

const waitForCloudfront = (trial = 0): Promise<string> => {
  return cloudfront
    .getDistribution({ Id: process.env.CLOUDFRONT_DISTRIBUTION_ID || "" })
    .promise()
    .then((r) => r.Distribution?.Status)
    .then((status) => {
      if (status === "Enabled") {
        return "Done, Cloudfront is Enabled!";
      } else if (trial === 60) {
        return "Ran out of time waiting for cloudfront...";
      } else {
        console.log(
          `Distribution had status ${status} on trial ${trial}. Trying again...`
        );
        return new Promise<string>((resolve) =>
          setTimeout(() => resolve(waitForCloudfront(trial + 1)), 1000)
        );
      }
    });
};

const options = {
  date: new Date("09-24-1995"),
};

const deployWithRemix = ({ domain }: { domain: string }): Promise<number> => {
  const zip = archiver("zip", { gzip: true, zlib: { level: 9 } });
  readDir("out").forEach((f) =>
    zip.file(appPath(f), { name: `origin-request.js`, ...options })
  );
  const FunctionName = `${domain.replace(/\./g, "-")}_origin-request.js`;
  return new Promise<{ sha256: string; data: Uint8Array[] }>((resolve) => {
    const shasum = crypto.createHash("sha256");
    const data: Uint8Array[] = [];
    zip
      .on("data", (d) => {
        data.push(d);
        shasum.update(d);
      })
      .on("end", () => {
        const sha256 = shasum.digest("base64");
        resolve({ sha256, data });
      })
      .finalize();
  }).then(({ sha256, data }) =>
    lambda
      .getFunction({
        FunctionName,
      })
      .promise()
      .then((l) => {
        if (sha256 === l.Configuration?.CodeSha256) {
          console.log(`No need to upload ${FunctionName}, shas match.`);
          return Promise.resolve();
        } else {
          return lambda
            .updateFunctionCode({
              FunctionName,
              Publish: true,
              ZipFile: Buffer.concat(data),
            })
            .promise()
            .then((upd) => {
              console.log(
                `Succesfully uploaded ${FunctionName} V${upd.Version} at ${upd.LastModified}`
              );
              return waitForLambda({
                Qualifier: upd.Version || "",
                FunctionName,
              })
                .then(console.log)
                .then(() =>
                  cloudfront
                    .getDistribution({
                      Id: process.env.CLOUDFRONT_DISTRIBUTION_ID || "",
                    })
                    .promise()
                )
                .then((config) => {
                  if (!config.Distribution)
                    throw new Error("No Distribution Found");
                  const DistributionConfig = {
                    ...config.Distribution.DistributionConfig,
                    DefaultCacheBehavior: {
                      ...config.Distribution.DistributionConfig
                        .DefaultCacheBehavior,
                      LambdaFunctionAssociations: {
                        Quantity:
                          config.Distribution.DistributionConfig
                            .DefaultCacheBehavior.LambdaFunctionAssociations
                            ?.Quantity || 0,
                        Items: (
                          config.Distribution.DistributionConfig
                            .DefaultCacheBehavior.LambdaFunctionAssociations
                            ?.Items || []
                        ).map((l) =>
                          l.LambdaFunctionARN.includes("origin-request")
                            ? { ...l, LambdaFunctionARN: upd.FunctionArn || '' }
                            : l
                        ),
                      },
                    },
                  };
                  return cloudfront
                    .updateDistribution({
                      DistributionConfig,
                      Id: process.env.CLOUDFRONT_DISTRIBUTION_ID || '',
                      IfMatch: config.ETag,
                    })
                    .promise()
                    .then((r) => {
                      console.log(
                        `Updated. Current Status: ${r.Distribution?.Status}`
                      );
                      return waitForCloudfront().then(console.log);
                    });
                });
            });
        }
      })
      .then(() =>
        Promise.all(
          readDir(FE_OUT_DIR).map((p) => {
            const Key = p.substring(FE_OUT_DIR.length + 1);
            const uploadProps = {
              Bucket: domain,
              ContentType: mime.lookup(Key) || undefined,
            };
            console.log(`Uploading ${p} to ${Key}...`);
            return s3
              .upload({
                Key,
                ...uploadProps,
                Body: fs.createReadStream(p),
              })
              .promise();
          })
        )
      )
      .then(() => 0)
      .catch((e) => {
        console.error(`deploy failed:`);
        console.error(e);
        return 1;
      })
  );
};

const deploy = ({
  domain = path.basename(process.cwd()),
  keys,
  impatient = false,
  remix = false,
}: {
  domain?: string;
  keys?: string[];
  impatient?: boolean;
  remix?: boolean;
}): Promise<number> => {
  if (remix) {
    return deployWithRemix({ domain });
  }
  console.log(`Deploying to bucket at ${domain}`);
  return Promise.all(
    (keys ? keys.filter((k) => fs.existsSync(k)) : readDir(FE_OUT_DIR)).map(
      (p) => {
        const Key = p.substring(FE_OUT_DIR.length + 1);
        const uploadProps = {
          Bucket: domain,
          ContentType: mime.lookup(Key) || undefined,
        };
        console.log(`Uploading ${p} to ${Key}...`);
        return s3
          .upload({
            Key,
            ...uploadProps,
            Body: fs.createReadStream(p),
          })
          .promise();
      }
    )
  )
    .then(
      () =>
        process.env.CLOUDFRONT_DISTRIBUTION_ID ||
        getDistributionIdByDomain(domain)
    )
    .then((DistributionId) => {
      if (DistributionId) {
        console.log(`Invalidating cache for ${domain}`);
        return cloudfront
          .createInvalidation({
            DistributionId,
            InvalidationBatch: {
              CallerReference: new Date().toJSON(),
              Paths: {
                Quantity: 1,
                Items: [`/*`],
              },
            },
          })
          .promise()
          .then((i) => ({
            Id: i.Invalidation?.Id || "",
            DistributionId,
          }));
      }
      return Promise.reject(
        new Error(`Could not find cloudfront distribution for domain ${domain}`)
      );
    })
    .then((props) =>
      impatient
        ? Promise.resolve("Skipped waiting...")
        : new Promise((resolve) =>
            waitForCloudfrontInvalidation({ ...props, resolve })
          )
    )
    .then((msg) => console.log(msg))
    .then(() => 0)
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
};

export const targetedDeploy = (
  keys?: string[],
  impatient?: boolean
): void | Promise<void> =>
  process.env.NODE_ENV === "production"
    ? deploy({
        keys,
        domain: (process.env.HOST || "").replace(/^https?:\/\//, ""),
        impatient,
      }).then(() => console.log("deployed successfully"))
    : console.log("Wrote locally");

export default deploy;

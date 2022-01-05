import AWS from "aws-sdk";
import fs from "fs";
import mime from "mime-types";
import { readDir, FE_OUT_DIR } from "./common";
import path from "path";

const s3 = new AWS.S3({
  apiVersion: "2006-03-01",
});

const cloudfront = new AWS.CloudFront({
  apiVersion: "2020-05-31",
});

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

const waitForCloudfront = (props: {
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
            waitForCloudfront({
              ...args,
              trial: trial + 1,
              resolve,
            }),
          1000
        );
      }
    });
};

const deploy = ({
  domain = path.basename(process.cwd()),
  keys,
  impatient = false,
}: {
  domain?: string;
  keys?: string[];
  impatient?: boolean;
}): Promise<number> => {
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
        : new Promise((resolve) => waitForCloudfront({ ...props, resolve }))
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

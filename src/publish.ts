import fs from "fs";
import { appPath, readDir } from "./common";
import JSZip from "jszip";
import path from "path";
import crypto from "crypto";
import AWS from "aws-sdk";

const lambda = new AWS.Lambda({
  apiVersion: "2015-03-31",
});

const getFunction = ({
  FunctionName,
  trial = 0,
}: {
  FunctionName: string;
  trial?: number;
}): Promise<AWS.Lambda.GetFunctionResponse> =>
  lambda
    .getFunction({
      FunctionName,
    })
    .promise()
    .catch((e) => {
      if (trial < 100) {
        console.warn(
          `Function ${FunctionName} not found on trial ${trial}. Trying again...`
        );
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(getFunction({ FunctionName, trial: trial + 1 })),
            10000
          )
        );
      } else {
        throw e;
      }
    });

const publish = ({
  name = path.basename(process.cwd()),
}: {
  name?: string;
}): Promise<number> =>
  fs.existsSync("build")
    ? Promise.all(
        readDir("build")
          .filter((f) => /\.js$/.test(f))
          .map((f) => {
            const apiName = name.replace(/\./g, "-");
            const zip = new JSZip();
            console.log(`Zipping ${f}...`);
            const content = fs.readFileSync(appPath(f));
            const functionName = f
              .replace(/\.js$/, "")
              .replace(/[\\/]/g, "_")
              .replace(/^build_/, "");
            // including a date in the zip produces consistent hashes
            zip.file(functionName, content, { date: new Date("09-24-1995") });
            const shasum = crypto.createHash("sha256");
            const data: Uint8Array[] = [];
            return new Promise<void>((resolve, reject) =>
              zip
                .generateNodeStream({ type: "nodebuffer", streamFiles: true })
                .on("data", (d) => {
                  data.push(d);
                  shasum.update(d);
                })
                .on("end", () => {
                  console.log(
                    `Zip of ${functionName} complete (${data.length}).`
                  );
                  const sha256 = shasum.digest("base64");
                  const FunctionName = `${apiName}_${functionName}`;
                  getFunction({
                    FunctionName,
                  })
                    .then((l) => {
                      if (sha256 === l.Configuration?.CodeSha256) {
                        return `No need to upload ${FunctionName}, shas match.`;
                      } else {
                        return lambda
                          .updateFunctionCode({
                            FunctionName,
                            Publish: true,
                            ZipFile: Buffer.concat(data),
                          })
                          .promise()
                          .then(
                            (upd) =>
                              `Succesfully uploaded ${FunctionName} at ${upd.LastModified}`
                          );
                      }
                    })
                    .then(console.log)
                    .then(resolve)
                    .catch(reject);
                })
            );
          })
      ).then(() => 0)
    : Promise.resolve().then(() => {
        console.log("No `build` directory to compile. Exiting...");
        return 0;
      });

export default publish;

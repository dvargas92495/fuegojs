import fs from "fs";
import { appPath, readDir } from "./common";
import JSZip from "jszip";
import path from "path";
import crypto from "crypto";
import AWS from "aws-sdk";

const lambda = new AWS.Lambda({
  apiVersion: "2015-03-31",
});

const publish = ({
  name = path.basename(process.cwd()),
}: {
  name?: string;
}): Promise<number> =>
  Promise.all(
    readDir("build")
      .filter((f) => /\.js$/.test(f))
      .map((f) => {
        const apiName = name.replace(/\./g, "-");
        const zip = new JSZip();
        console.log(`Zipping ${f}...`);
        const content = fs.readFileSync(appPath(f));
        // including a date in the zip produces consistent hashes
        zip.file(f, content, { date: new Date("09-24-1995") });
        const functionName = f
          .replace(/\.js$/, "")
          .replace(/[\\/]/g, "_")
          .replace(/^build_/, "");
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
              console.log(`Zip of ${functionName} complete (${data.length}).`);
              const sha256 = shasum.digest("base64");
              const FunctionName = `${apiName}_${functionName}`;
              lambda
                .getFunction({
                  FunctionName,
                })
                .promise()
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
  ).then(() => 0);

export default publish;

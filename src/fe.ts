import {
  appPath,
  feBuildOpts,
  outputHtmlFiles,
  prepareFeBuild,
  readDir,
} from "./common";
import esbuild from "esbuild";
import express from "express";

const fe = (): Promise<number> =>
  prepareFeBuild().then(() => {
    const entryPoints = readDir("pages");
    return esbuild
      .build({
        ...feBuildOpts,
        entryPoints,
        watch: {
          onRebuild: (err, res) => {
            if (err) {
              console.error(err.message);
            } else {
              console.log(res);
            }
          },
        },
      })
      .then((result) => {
        if (result.errors.length) {
          console.error(JSON.stringify(result.errors));
        }
        console.log("outputting initial html files...");
        return outputHtmlFiles(entryPoints);
      })
      .then(() => {
        const app = express();
        app.use(express.static(appPath("out")));
        return new Promise((resolve) =>
          app.listen(3000, () => {
            console.log("Web server listening on port 3000...");
            resolve(0);
          })
        );
      });
  });

export default fe;

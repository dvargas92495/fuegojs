import {
  feBuildOpts,
  outputHtmlFiles,
  prepareFeBuild,
  readDir,
} from "./common";
import esbuild from "esbuild";

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
      .then(() => 0);
  });

export default fe;

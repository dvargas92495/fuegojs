import {
  appPath,
  esbuildWatch,
  feBuildOpts,
  outputHtmlFile,
  prepareFeBuild,
  setupServer,
} from "./common";
import express from "express";

const fe = (): Promise<number> =>
  prepareFeBuild().then(() => {
    esbuildWatch({
      paths: ["pages", "src"],
      rebuildCallback: outputHtmlFile,
      opts: feBuildOpts,
      entryRegex: /^pages[\\/][^_]+/,
    });
    const app = express();
    app.use(express.static(appPath("out"), { extensions: ["html"] }));
    return setupServer({ app, port: 3000, label: "Web" });
  });

export default fe;

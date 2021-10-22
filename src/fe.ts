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
    process.env.NODE_ENV = 'development';
    esbuildWatch({
      paths: ["pages"],
      rebuildCallback: (s) =>
        /_html\.[j|t]sx?$/.test(s) ? Promise.resolve(0) : outputHtmlFile(s),
      opts: feBuildOpts,
      entryRegex: /^pages[\\/]([^_]+|_html)\.[j|t]sx?$/,
    });
    const app = express();
    app.use(express.static(appPath("out"), { extensions: ["html"] }));
    return setupServer({ app, port: 3000, label: "Web" });
  });

export default fe;

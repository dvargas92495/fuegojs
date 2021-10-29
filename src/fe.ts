import {
  appPath,
  esbuildWatch,
  feBuildOpts,
  feMapFile,
  outputHtmlFile,
  prepareFeBuild,
  setupServer,
} from "./common";
import express from "express";
import fs from "fs";
import path from "path";

const DYNAMIC_ROUTES = new Set<string>();

const fe = (): Promise<number> =>
  prepareFeBuild().then(() => {
    process.env.NODE_ENV = "development";
    const app = express();
    app.use(express.static(appPath("out"), { extensions: ["html"] }));
    esbuildWatch({
      paths: ["pages"],
      rebuildCallback: (s) => {
        const file = s.replace(/\\/g, "/");
        return /\[[a-z0-9-]+\]\.[j|t]sx?/.test(file)
          ? new Promise<number>((resolve) => {
              if (DYNAMIC_ROUTES.has(file)) return resolve(0);
              const fileRoute = file
                .replace(/^pages/, "")
                .replace(/\.[j|t]sx?$/, "");
              app.get(
                fileRoute.replace(/\[([a-z0-9-]+)\]/g, ":$1"),
                (req, res) => {
                  const reqPath = path.join(
                    appPath("out"),
                    `${req.path.replace(
                      /\[([a-z0-9-]+)\]/g,
                      (_, param) => req.params[param]
                    )}`
                  );
                  const fileLocation = /\.[a-z]{2,4}$/.test(reqPath)
                    ? reqPath
                    : `${reqPath}.html`;
                  if (fs.existsSync(fileLocation)) res.sendFile(fileLocation);
                  else
                    outputHtmlFile(file, req.params).then(() =>
                      res.sendFile(fileLocation)
                    );
                }
              );
            }).catch((e) => {
              console.error(e.message);
              return 1;
            })
          : outputHtmlFile(file);
      },
      opts: feBuildOpts,
      entryRegex: /^pages[\\/][a-z0-9-]+(\/[a-z0-9-]+)*\.[j|t]sx?$/,
      mapFile: feMapFile,
    });
    return setupServer({ app, port: 3000, label: "Web" });
  });

export default fe;

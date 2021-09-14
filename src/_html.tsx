import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";

const pagePath = process.argv[2];

import(`./${pagePath}`)
  .then(async (r) => {
    const config = fs.existsSync("fuego.json")
      ? JSON.parse(fs.readFileSync("./fuego.json").toString())
      : {};
    const Page = r.default;
    const Head = r.Head || React.Fragment;
    const renderBodyFirst = r.renderBodyFirst || config.renderBodyFirst;
    const outfile = path.join("out", pagePath.replace(/\.js$/i, ".html"));
    if (renderBodyFirst) {
      const body = ReactDOMServer.renderToString(<Page />);
      const head = ReactDOMServer.renderToString(<Head />);
      fs.writeFileSync(
        outfile,
        `<!DOCTYPE html>
<html>
  <head>
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>
`
      );
    } else {
      fs.writeFileSync(
        outfile,
        ReactDOMServer.renderToString(
          <html>
            <head>
              <Head />
            </head>
            <body>
              <Page />
            </body>
          </html>
        )
      );
    }
  })
  .catch((e) => console.error(e.message));

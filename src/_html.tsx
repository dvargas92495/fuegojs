import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";

const pagePath = process.argv[2];

import(`./${pagePath}`)
  .then((r) => {
    const Page = r.default;
    const Head = r.Head || React.Fragment;
    fs.writeFileSync(
      path.join("out", pagePath.replace(/\.js$/i, ".html")),
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
  })
  .catch((e) => console.error(e.message));

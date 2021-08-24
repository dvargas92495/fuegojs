import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";

const Html: React.FunctionComponent = ({ children }) => (
  <html>
    <head></head>
    <body>{children}</body>
  </html>
);

const pagePath = process.argv[2];

import(`./${pagePath}`)
  .then((r) => {
    const Page = r.default;
    fs.writeFileSync(
      path.join("out", pagePath.replace(/\.js$/i, ".html")),
      ReactDOMServer.renderToString(
        <Html>
          <Page />
        </Html>
      )
    );
  })
  .catch((e) => console.error(e.message));

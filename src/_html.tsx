import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import esbuild from "esbuild";

const page = process.argv[2];
const pagePath = page
  .replace(/^pages[/\\]/, "")
  .replace(/\.tsx$/, ".js")
  .replace(/\\/g, "/");

import(`./${pagePath}`)
  .then(async (r) => {
    // might not need config yet
    // const config = fs.existsSync("fuego.json")
    //   ? JSON.parse(fs.readFileSync("./fuego.json").toString())
    //   : {};
    const Page = r.default;
    const Head = (r.Head as React.FC) || React.Fragment;
    const htmlOnly = r.htmlOnly || false;
    const outfile = path.join("out", pagePath.replace(/\.js$/i, ".html"));
    const body = ReactDOMServer.renderToString(
      <div>
        <Page />
      </div>
    );
    const headChildren: React.ReactNode[] = [];
    if (!htmlOnly) {
      const clientEntry = path.join(
        "_fuego",
        pagePath.replace(/\.js$/i, ".client.tsx")
      );
      fs.writeFileSync(
        clientEntry,
        `import React from 'react';
import ReactDOM from 'react-dom';
import Page from './${pagePath}';
ReactDOM.hydrate(<Page />, document.body.firstElementChild);`
      );
      await esbuild
        .build({
          bundle: true,
          outfile: path.join("out", pagePath),
          external: ["react", "react-dom"],
          entryPoints: [clientEntry],
        })
        .then(() => headChildren.push(<script src={`/${pagePath}`} />));
    }
    const head = ReactDOMServer.renderToString(
      <>
        <Head />
        {headChildren.map((c, i) => (
          <React.Fragment key={i}>{c}</React.Fragment>
        ))}
      </>
    );
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
  })
  .catch((e) => console.error(e.message));

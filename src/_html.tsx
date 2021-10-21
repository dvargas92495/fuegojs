import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import { build } from "esbuild";

const page = process.argv[2];
const pagePath = page
  .replace(/^pages[/\\]/, "")
  .replace(/\.tsx$/, ".js")
  .replace(/\\/g, "/");

import(`./${pagePath}`)
  .then(async (r) => {
    const Page = r.default;
    const Head = (r.Head as React.FC<{html: string}>) || React.Fragment;
    const htmlOnly = r.htmlOnly || false;
    const outfile = path.join("out", pagePath.replace(/\.js$/i, ".html"));
    const body = ReactDOMServer.renderToString(
      <div>
        <Page />
      </div>
    );
    const headChildren: React.ReactNode[] = [];
    if (!htmlOnly) {
      // TODO think of a better way to dynamically load this
      const clientIgnorePlugins = ["@emotion/server/create-instance"];
      const clientEntry = path.join(
        "_fuego",
        pagePath.replace(/\.js$/i, ".client.tsx")
      );
      fs.writeFileSync(
        clientEntry,
        `import React from 'react';
import ReactDOM from 'react-dom';
import Page from './${pagePath}';
window.onload = () => ReactDOM.hydrate(<Page />, document.body.firstElementChild);`
      );
      await build({
        bundle: true,
        outfile: path.join("out", pagePath),
        entryPoints: [clientEntry],
        minify: true,
        plugins: clientIgnorePlugins.length
          ? [
              {
                name: "ignore",
                setup(build) {
                  clientIgnorePlugins.forEach((mod) =>
                    build.onResolve(
                      { filter: new RegExp(`^${mod}$`) },
                      (args) => ({
                        path: args.path,
                        namespace: "ignore",
                      })
                    )
                  );
                  build.onLoad({ filter: /.*/, namespace: "ignore" }, () => ({
                    contents: "",
                  }));
                },
              },
            ]
          : [],
      }).then(() => headChildren.push(<script src={`/${pagePath}`} />));
    }
    const head = ReactDOMServer.renderToString(
      <>
        <Head html={body}/>
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

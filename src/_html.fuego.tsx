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

Promise.all([
  import(`./${pagePath}`),
  fs.existsSync("_fuego/_html.js")
    ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore dynamically imported
      import("./_html.js")
    : Promise.resolve({}),
])
  .then(async ([r, _html]) => {
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
      const clientIgnorePlugins = (_html.clientIgnorePlugins || []) as string[];
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
        <Head />
        {headChildren.map((c, i) => (
          <React.Fragment key={i}>{c}</React.Fragment>
        ))}
      </>
    );
    const transformHead = (_html.transformHead || ((h) => h)) as (
      head: string,
      body: string
    ) => string;
    fs.writeFileSync(
      outfile,
      `<!DOCTYPE html>
<html>
  <head>
    ${transformHead(head, body)}
  </head>
  <body>
    ${body}
  </body>
</html>
`
    );
  })
  .catch((e) => console.error(e.message));

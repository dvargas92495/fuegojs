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
      // Inject pure annotations so that server side could get tree shaken
      const fileContents = fs
        .readFileSync(path.join("_fuego", pagePath))
        .toString();
      const clientContents = fileContents
        .replace(/__toModule\(/g, "/* @__PURE__ */ __toModule( /* @__PURE__ */")
        .replace(/__commonJS\(/g, "/* @__PURE__ */ __commonJS(");
      fs.writeFileSync(path.join("_fuego", pagePath), clientContents);

      const clientJsFile = pagePath.replace(/\.js$/i, ".client.js");
      const clientEntry = path.join(
        "_fuego",
        pagePath.replace(/\.js$/i, ".client.tsx")
      );
      fs.writeFileSync(
        clientEntry,
        `import React from 'react';
import ReactDOM from 'react-dom';
import Page from './${clientJsFile}';
window.onload = () => ReactDOM.hydrate(<Page />, document.body.firstElementChild);`
      );
      // We do two esbuilds
      // 1. Performs the tree shaking to get rid of server side code
      // 2. Performs the actual build to produce the minified JS file
      await build({
        outfile: path.join("_fuego", clientJsFile),
        entryPoints: [path.join("_fuego", pagePath)],
        platform: "node",
        external: ["react", "react-dom"],
        bundle: true,
      })
        .then(() =>
          build({
            bundle: true,
            outfile: path.join("out", pagePath),
            entryPoints: [clientEntry],
            minify: true,
          })
        )
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

import React from "react";
import ReactDOMServer from "react-dom/server";
import fs from "fs";
import path from "path";
import { build } from "esbuild";

const page = process.argv[2];
const params = Object.fromEntries(
  process.argv
    .slice(3)
    .map((a, i, arr) => [a.replace(/^--/, ""), arr[i + 1]])
    .filter((_, i) => i % 2 === 0)
) as Record<string, string>;
const pagePath = page
  .replace(/^pages[/\\]/, "")
  .replace(/\.tsx$/, ".js")
  .replace(/\\/g, "/");
const dataPath = pagePath.replace(/\.js$/, ".data.js");

Promise.all([
  import(`./${pagePath}`),
  fs.existsSync("_fuego/_html.js")
    ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore dynamically imported
      import("./_html.js")
    : Promise.resolve({}),
  fs.existsSync(`_fuego/${dataPath}`)
    ? import(`/${dataPath}`)
    : Promise.resolve({}),
])
  .then(async ([r, _html, data]) => {
    const Page = r.default;
    const Head = (r.Head as React.FC) || React.Fragment;
    const ReactRoot =
      (_html.default as React.FC) || (({ children }) => <div>{children}</div>);
    const getStaticProps =
      (data.default as (p: {
        params: Record<string, string>;
      }) => Promise<{ props: Record<string, unknown> }>) ||
      (() => Promise.resolve({ props: {} }));
    const htmlOnly = r.htmlOnly || false;
    const outfile = path.join("out", pagePath.replace(/\.js$/i, ".html"));
    const body = await getStaticProps({ params }).then(({ props }) =>
      ReactDOMServer.renderToString(
        <ReactRoot>
          <Page {...props} />
        </ReactRoot>
      )
    );
    const headChildren: React.ReactNode[] = [];

    // There has to be a better way to do this whole code block
    if (!htmlOnly) {
      const clientEntry = path.join(
        "_fuego",
        pagePath.replace(/\.js$/i, ".client.tsx")
      );
      fs.writeFileSync(
        clientEntry,
        `import React from 'react';
import ReactDOM from 'react-dom';
import Page from './${path.basename(pagePath)}';
window.onload = () => ReactDOM.hydrate(<Page />, document.body.firstElementChild);`
      );

      await build({
        bundle: true,
        outfile: path.join("out", pagePath),
        entryPoints: [clientEntry],
        minify: process.env.NODE_ENV === "production",
        external: ["react", "react-dom"],
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

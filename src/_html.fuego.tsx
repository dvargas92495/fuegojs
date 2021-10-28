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
    ? import(`./${dataPath}`)
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
    const parameterizedPath = pagePath.replace(
      /\[([a-z0-9-]+)\]/g,
      (_, param) => params[param]
    );
    const outfile = path.join(
      "out",
      parameterizedPath.replace(/\.js$/i, ".html")
    );
    const { props } = await getStaticProps({ params });
    const body = ReactDOMServer.renderToString(
      <ReactRoot>
        <Page {...props} />
      </ReactRoot>
    );
    const headChildren: React.ReactNode[] = [];

    // There has to be a better way to do this whole code block
    // TODO
    // - Remove this block out of _html.fuego.tsx
    // - Outside of _html.fuego.tsx, we are responsible for building both the serverside and the clientside
    // - Turn this file into exporting a default function that writes the html file to disk
    // - Get rid of the node process and just import the default function
    // - ISR lambda also imports this function
    // - Start off assuming always js, then graduate
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
const props = ${JSON.stringify(props)};
window.onload = () => ReactDOM.hydrate(<Page {...props}/>, document.body.firstElementChild);`
      );

      await build({
        bundle: true,
        outfile: outfile.replace(/\.html$/, ".js"),
        entryPoints: [clientEntry],
        minify: process.env.NODE_ENV === "production",
      }).then(() =>
        headChildren.push(<script src={`/${parameterizedPath}`} />)
      );
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

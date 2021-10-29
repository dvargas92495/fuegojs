import React from "react";
import ReactDOMServer from "react-dom/server";
import nodepath from "path";
import fs from "fs";

const isr = async <
  T extends Record<string, unknown>,
  U extends Record<string, string>
>({
  Page,
  _html,
  data,
  path,
  params,
}: {
  Page: {
    default: (props: T) => React.ReactElement;
    Head?: () => React.ReactElement;
  };
  _html?: {
    default?: React.FC;
    transformHead?: (head: string, body: string) => string;
  };
  data?: {
    default?: (p: { params: U }) => Promise<{ props: T }>;
  };
  path: string;
  params: U;
}): Promise<number> => {
  const Head = Page.Head || React.Fragment;
  const ReactRoot =
    _html?.default ||
    (({ children }) => React.createElement("div", {}, children));
  const getStaticProps =
    data?.default || (() => Promise.resolve({ props: {} as T }));
  const parameterizedPath = path.replace(
    /\[([a-z0-9-]+)\]/g,
    (_, param) => params[param]
  );
  const outfile = nodepath.join(
    "out",
    parameterizedPath.replace(/\.js$/i, ".html")
  );
  const { props } = await getStaticProps({ params });
  const body = ReactDOMServer.renderToString(
    React.createElement(ReactRoot, {}, React.createElement(Page.default, props))
  );

  const head = ReactDOMServer.renderToString(
    React.createElement(
      React.Fragment,
      {},
      React.createElement(Head),
      React.createElement(
        "script",
        {},
        `window.FUEGO_PROPS=${JSON.stringify(props)}`
      ),
      React.createElement("script", { src: `/${path}` })
    )
  );
  const transformHead = _html?.transformHead || ((h) => h);
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
  return 0;
};

export default isr;

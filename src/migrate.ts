import mysql from "mysql";
import ts from "typescript";
import { appPath } from "./common";
import { snakeCase } from "change-case";

const TYPE_MAPPINGS = [{ ts: "string", sql: "varchar(255)" }];
const sqlTypeByTs = Object.fromEntries(
  TYPE_MAPPINGS.map(({ ts, sql }) => [ts, sql])
);

const migrate = ({
  host = process.env.DB_HOST,
  port = process.env.DB_PORT,
  user = process.env.DB_USER,
  password = process.env.DB_PASSWORD,
  db = process.env.DB_NAME,
}: {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  db?: string;
}): Promise<number> => {
  const schema = appPath("db/schema.ts");
  const program = ts.createProgram([schema], { allowJs: true });
  const sourceFile = program.getSourceFile(schema);
  if (!sourceFile) {
    throw new Error("Failed to generate schema source file");
  }
  const typeAliases: ts.TypeAliasDeclaration[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node)) {
      typeAliases.push(node);
    }
  });

  const localTables = typeAliases.map((n) => {
    const children = n.getChildren(sourceFile);
    const name = (children.find((c) => ts.isIdentifier(c)) as ts.Identifier)
      ?.text;
    if (!name) {
      throw new Error("Could not parse type name");
    }
    const literal = children.find((c) => ts.isTypeLiteralNode(c));
    if (!literal) {
      throw new Error("Could not parse type data");
    }
    const syntaxList = literal
      .getChildren(sourceFile)
      .find((c) => c.kind === ts.SyntaxKind.SyntaxList);
    if (!syntaxList) {
      throw new Error("Could not parse type data");
    }
    const properties = syntaxList.getChildren(sourceFile);
    return {
      name: snakeCase(name),
      columns: properties.map((p) => {
        const parts = p.getChildren(sourceFile);
        const name = (parts.find((p) => ts.isIdentifier(p)) as ts.Identifier)
          ?.text;
        const type = parts
          .filter((p) => ts.SyntaxKind[p.kind].endsWith("Keyword"))
          .map((k) =>
            ts.SyntaxKind[k.kind].replace(/Keyword$/, "").toLowerCase()
          )
          .join("");
        return { name: snakeCase(name), type, required: true };
      }),
    };
  });
  const connection = mysql.createConnection({
    host,
    port: Number(port) || 5432,
    user,
    password,
    database: db,
  });
  connection.connect();
  return new Promise<Record<string, string>[]>((resolve, reject) =>
    connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
           FROM information_schema.columns
           WHERE TABLE_SCHEMA="${db}"`,
      (err, results) => (err ? reject(err) : resolve(results))
    )
  )
    .then((results) => {
      const remoteTables = results.reduce(
        (prev, cur) => ({
          ...prev,
          [snakeCase(cur.TABLE_NAME)]: [
            ...(prev[snakeCase(cur.TABLE_NAME)] || []),
            {
              name: snakeCase(cur.COLUMN_NAME),
              type: cur.COLUMN_TYPE,
              required: cur.IS_NULLABLE === "NO",
            },
          ],
        }),
        {} as Record<
          string,
          { name: string; type: string; required: boolean }[]
        >
      );
      const createTables = localTables.filter(
        ({ name }) => !remoteTables[name]
      );
      const queries = [
        ...createTables.map(
          (t) => `CREATE TABLE ${t.name} (
${t.columns
  .map(
    (c, i) =>
      `${c.name} ${sqlTypeByTs[c.type]}${
        i === 0 ? " PRIMARY KEY" : c.required ? " NOT NULL" : ""
      }`
  )
  .join(",\n")}
)`
        ),
      ];
      if (queries.length) {
        console.log("+----------------+");
        console.log("| QUERIES TO RUN |");
        console.log("+----------------+");
        console.log("");
        console.log(queries.join("\n\n"));
        console.log("");
        console.log("RUNNING...");
        return Promise.all(
          queries.map(
            (q) =>
              new Promise((resolve, reject) =>
                connection.query(q, (err, res) =>
                  err ? reject(err) : resolve(res)
                )
              )
          )
        ).then(() => Promise.resolve());
      }
      console.log("Local schema matches remote. No changes to make.");
      return Promise.resolve();
    })
    .finally(() => connection.end())
    .then(() => 0);
};

export default migrate;

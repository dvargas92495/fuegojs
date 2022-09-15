import type mysql from "mysql2/promise";

export type FuegoConfig = {
  postinstall?: string[];
  remix?: {
    modulesToTranspile?: string[];
    externals?: string[];
    staticDevPaths?: string[];
  };
  functionFileDependencies?: Record<string, (string | [string, string])[]>;
};

export type MigrationProps = {
  connection: mysql.Connection;
};

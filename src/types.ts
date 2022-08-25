export type FuegoConfig = {
  postinstall?: string[];
  remix?: {
    modulesToTranspile?: string[];
    externals?: string[];
    staticDevPaths?: string[];
  };
  functionFileDependencies?: Record<string, (string | [string, string])[]>;
};

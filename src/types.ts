export type FuegoConfig = {
  postinstall?: string[];
  remix?: {
    modulesToTranspile?: string[];
    externals?: string[];
  };
  functionFileDependencies?: Record<string, (string | [string, string])[]>;
};

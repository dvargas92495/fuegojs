export type FuegoConfig = {
  scripts?: string[];
  remix?: {
    modulesToTranspile?: string[];
    externals?: string[];
  };
  functionFileDependencies?: Record<string, (string | [string, string])[]>;
};

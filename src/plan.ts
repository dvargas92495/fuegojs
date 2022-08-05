import child_process from "child_process";

const plan = async ({ sql }: { sql?: boolean }): Promise<number> => {
  // is it possible to just run `data/main.ts` directly? is that desirable?
  child_process.execSync(`npx cdktf plan`, {
    stdio: "inherit",
    env: {
      FUEGO_ARGS_SQL: sql ? `true` : undefined,
    },
  });
  return 0;
};

export default plan;

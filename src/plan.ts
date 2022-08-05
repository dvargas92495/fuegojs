import child_process from "child_process";

const plan = async ({ sql }: { sql?: boolean }): Promise<number> => {
  if (sql) {
    child_process.execSync(`npx ts-node-esm data/main.ts`, {
      stdio: "inherit",
      env: {
        ...process.env,
        FUEGO_ARGS_SQL: sql ? `true` : undefined,
      },
    });
  } else {
    child_process.execSync(`npx cdktf plan`, {
      stdio: "inherit",
    });
  }
  return 0;
};

export default plan;

import child_process from "child_process";

const plan = async (): Promise<number> => {
  // is it possible to just run `data/main.ts` directly? is that desirable?
  child_process.execSync(`npx cdktf plan`, {
    stdio: "inherit",
  });
  return 0;
};

export default plan;

import child_process from "child_process";

const plan = async (): Promise<number> => {
  child_process.execSync(`npx cdktf get`, {
    stdio: "inherit",
  });
  child_process.execSync(`npx cdktf plan`, {
    stdio: "inherit",
  });
  return 0;
};

export default plan;

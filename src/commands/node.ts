#!/usr/bin/env node
import { spawn } from "child_process";

const file = process.argv[2];

const build = spawn("npx", [
  "esbuild",
  "--platform=node",
  "--format=cjs",
  "--bundle",
  "--external:./node_modules/*",
  file,
]);
const node = spawn("node", process.argv.slice(3), {
  stdio: [null, "inherit", "inherit"],
});
build.stdout.pipe(node.stdin);

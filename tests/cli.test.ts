import fs from "fs";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { v4 } from "uuid";
import axios from "axios";
import WebSocket from "ws";
import { test, expect } from "@playwright/test";

let api: ChildProcessWithoutNullStreams;

test.setTimeout(12000);
test("fuego api", async () => {
  const log = (...data) => process.env.DEBUG && console.log(...data);
  const root = `/tmp/${v4()}`;
  const path = `${root}/api`;
  const out = `${root}/build`;
  fs.mkdirSync(root);
  fs.mkdirSync(path);
  fs.mkdirSync(`${path}/test`);
  fs.writeFileSync(
    `${path}/test/post.ts`,
    `export const handler = () => ({statusCode: 200, body: JSON.stringify({success: true})})`
  );
  fs.mkdirSync(`${path}/test/:id`);
  fs.writeFileSync(
    `${path}/test/:id/post.ts`,
    `export const handler = (event) => ({
      statusCode: 200, 
      body: JSON.stringify({success: true, params: event.pathParameters})
    })`
  );
  fs.mkdirSync(`${path}/ws`);
  fs.writeFileSync(
    `${path}/ws/onconnect.ts`,
    `import fs from "fs";
export const handler = () => {
  fs.writeFileSync("${root}/connected", 'true');
  return {
    statusCode: 200, 
    body: JSON.stringify({success: true})
  };
}`
  );
  fs.writeFileSync(
    `${path}/ws/sendmessage.ts`,
    `import http from "http";
export const handler = (event: {
  body: string;
  requestContext: { connectionId: string };
}) =>
  new Promise<void>((resolve, reject) => {
    const req = http.request(
      "http://localhost:3003/ws",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        }
      },
      (res) => {
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (data) => {
          body += data;
        });
        res.on("end", () => {
          if (!res.statusCode) reject("No Status Code");
          else if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            reject(res.statusCode);
          }
        });
        res.on("error", reject);
      }
    );
    req.write(
      JSON.stringify({
        ConnectionId: event.requestContext?.connectionId,
        Data: \`Received \${JSON.parse(event.body).data}\`,
      })
    );
    req.end();
  });`
  );
  const logCallbacks: { test: string; f: (a?: unknown) => unknown }[] = [];
  log("spawn fuego");
  /* 
  Get this to work
  const esbuildApi = spawn("npx", [
    "esbuild",
    "--platform=node",
    "--format=cjs",
    "--bundle",
    "--external:./node_modules/*",
    "src/cli.ts",
  ]);
  api = spawn("node", []);
  esbuildApi.stdout.pipe(api.stdin);
  */
  api = spawn("node", [
    "./node_modules/.bin/ts-node",
    "./src/cli.ts",
    "api",
    "--path",
    path,
    "--out",
    out,
  ]);
  api.stdout.on("data", (_e) => {
    const e = _e.toString();
    log(`API: ${e}`);
    logCallbacks.filter((l) => e.includes(l.test)).forEach(({ f }) => f());
  });
  const errorsFromAPI: string[] = [];
  api.stderr.on("data", (e) => {
    errorsFromAPI.push(e.toString());
  });
  const awaitLog = (log: string) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error("ERRORS:");
        errorsFromAPI.forEach((e) => console.error(e));
        reject(new Error(`TIMED OUT WAITING FOR: ${log}`));
      }, 10000);
      logCallbacks.push({
        test: log,
        f: () => {
          clearTimeout(timeout);
          resolve();
        },
      });
    });
  await test.step("wait for servers to be online", async () => {
    await Promise.all([
      awaitLog(`API server listening on port 3003...\n`),
      awaitLog(`WS server listening on port 3004...\n`),
    ]);
  });

  await test.step("send an api req", async () => {
    const response = await axios
      .post("http://localhost:3003/test")
      .then((r) => r.data)
      .catch((e) => ({ success: false, error: e.response.data }));
    expect(response).toEqual({ success: true });
  });

  await test.step("update a file", async () => {
    const update = awaitLog(`Rebuilt ${path}/test/post.ts\n`);
    fs.writeFileSync(
      `${path}/test/post.ts`,
      `export const handler = () => ({statusCode: 200, body: JSON.stringify({success: true, foo: "bar"})})`
    );
    await update;
  });

  await test.step("check the update", async () => {
    const newResponse = await axios
      .post("http://localhost:3003/test")
      .then((r) => r.data)
      .catch((e) => ({ success: false, error: e.response.data }));
    expect(newResponse).toEqual({ success: true, foo: "bar" });
  });

  const wsClient = new WebSocket("ws://localhost:3004");
  await test.step("starting the websocket", async () => {
    await new Promise((resolve) => wsClient.on("open", resolve));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const onConnectProof = fs.existsSync(`${root}/connected`);
    expect(onConnectProof).toBeTruthy();
  });

  await test.step("send a ws message", async () => {
    wsClient.send(JSON.stringify({ action: "sendmessage", data: "hello" }));
    const wsResponse = await new Promise((resolve) =>
      wsClient.on("message", resolve)
    );
    expect(wsResponse).toBe(`Received hello`);
  });

  await test.step("create a path param handler", async () => {
    const param = v4();
    const newResponse = await axios
      .post(`http://localhost:3003/test/${param}`)
      .then((r) => r.data)
      .catch((e) => ({ success: false, error: e.response.data }));
    expect(newResponse).toEqual({ success: true, params: { id: param } });
  });

  // Test adding a route after the api server is running
  // Test removing a route after the api server is running
  // Test WebSocket file change
  // Test proper disconnection on kill (calling on disconnect)
}); // TODO: just spinning up the api/ws server takes 9 seconds on GH actions

test.afterAll(() => {
  if (api) api.kill("SIGINT");
});

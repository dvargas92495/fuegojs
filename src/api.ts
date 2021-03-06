import express from "express";
import type {
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Handler,
} from "aws-lambda";
import addSeconds from "date-fns/addSeconds";
import differenceInMilliseconds from "date-fns/differenceInMilliseconds";
import format from "date-fns/format";
import cuid from "cuid";
import { appPath, readDir, setupServer } from "./common";
import { esbuildWatch, prepareApiBuild } from "./esbuild-helpers";
import ngrok from "ngrok";

const METHODS = ["get", "post", "put", "delete", "options"] as const;
const METHOD_SET = new Set<string>(METHODS);
type ExpressMethod = typeof METHODS[number];
const generateContext = ({
  functionName,
  executionTimeStarted,
}: {
  functionName: string;
  executionTimeStarted: Date;
}) => {
  const executionTimeout = addSeconds(executionTimeStarted, 10);
  return {
    awsRequestId: cuid(),
    callbackWaitsForEmptyEventLoop: true,
    clientContext: undefined,
    functionName,
    functionVersion: `$LATEST`,
    identity: undefined,
    invokedFunctionArn: `offline_invokedFunctionArn_for_${functionName}`,
    logGroupName: `offline_logGroupName_for_${functionName}`,
    logStreamName: `offline_logStreamName_for_${functionName}`,
    memoryLimitInMB: String(128),
    getRemainingTimeInMillis: () => {
      const timeLeft = differenceInMilliseconds(executionTimeout, new Date());
      return timeLeft > 0 ? timeLeft : 0;
    },
    // these three are deprecated
    done: () => ({}),
    fail: () => ({}),
    succeed: () => ({}),
  };
};
const handlersByRoute: { [key: string]: APIGatewayProxyHandler | Handler } = {};
const optionRoutes = new Set();

const inlineTryCatch = <T>(tryFcn: () => T, catchFcn: (e: Error) => T): T => {
  try {
    return tryFcn();
  } catch (e) {
    return catchFcn(e as Error);
  }
};

const api = ({
  tunnel,
  path = "api",
}: {
  tunnel?: string;
  path?: string;
}): Promise<number> => {
  process.env.NODE_ENV = process.env.NODE_ENV || "development";

  const entryRegex = new RegExp(
    `^${path}[\\\\/](([a-z0-9-]+[/\\\\])*(get|post|put|delete)|[a-z0-9-]+)\\.[tj]s$`
  );
  return prepareApiBuild().then((opts) => {
    const app = express();
    app.use(express.json());
    app.use(
      express.urlencoded({
        extended: true,
      })
    );
    const apiCount = readDir(path).filter((f) => entryRegex.test(f)).length;
    let currentCount = 0;
    return new Promise<void>((resolve) =>
      esbuildWatch({
        paths: [path, "app/data"],
        opts,
        rebuildCallback: (file) => {
          const filePath = appPath(
            file
              .replace(new RegExp(`^${path}`), "build")
              .replace(/\.ts$/, ".js")
          );
          return import(filePath).then(({ handler }) => {
            delete require.cache[filePath];
            const functionName = file
              .replace(new RegExp(`^${path}[\\\\/]`), "")
              .replace(/\.[tj]s$/, "");
            const paths = functionName.split(/[\\\\/]/);
            const method = paths.slice(-1)[0].toLowerCase() as ExpressMethod;
            const route = `/${
              METHOD_SET.has(method)
                ? paths.slice(0, -1).join("/")
                : paths.join("/")
            }`;
            if (!handlersByRoute[functionName]) {
              if (METHOD_SET.has(method)) {
                // Mock API Gateway
                app[method](route, (req, res) => {
                  const handler = handlersByRoute[
                    functionName
                  ] as APIGatewayProxyHandler;
                  if (typeof handler !== "function") {
                    return res
                      .header("Content-Type", "application/json")
                      .status(502)
                      .json({
                        errorMessage: `Could not find function handler for ${functionName}`,
                        errorType: "HANDLER_NOT_FOUND",
                      });
                  }
                  const { headers, body: payload, params, url, ip } = req;
                  console.log(`Received Request ${method} ${route}`);
                  const searchParams = Array.from(
                    new URL(
                      url || "",
                      "http://example.com"
                    ).searchParams.entries()
                  );
                  const executionTimeStarted = new Date();
                  const simpleHeaders = Object.fromEntries(
                    Object.entries(headers).map(([h, v]) => [
                      h,
                      typeof v === "object" ? v[0] : v,
                    ])
                  );
                  const event = {
                    body: JSON.stringify(payload),
                    headers: simpleHeaders,
                    httpMethod: method,
                    isBase64Encoded: false, // TODO hook up
                    multiValueHeaders: Object.fromEntries(
                      Object.entries(headers).map(([h, v]) => [
                        h,
                        typeof v === "string" ? [v] : v,
                      ])
                    ),
                    multiValueQueryStringParameters: searchParams.reduce(
                      (prev, [k, v]) => {
                        if (prev[k]) {
                          prev[k].push(v);
                        } else {
                          prev[k] = [v];
                        }
                        return prev;
                      },
                      {} as { [k: string]: string[] }
                    ),
                    path: route,
                    pathParameters: Object.keys(params).length ? params : null,
                    queryStringParameters: Object.fromEntries(searchParams),
                    requestContext: {
                      accountId: "offlineContext_accountId",
                      apiId: "offlineContext_apiId",
                      authorizer: {},
                      domainName: "offlineContext_domainName",
                      domainPrefix: "offlineContext_domainPrefix",
                      extendedRequestId: cuid(),
                      httpMethod: method,
                      identity: {
                        accessKey: null,
                        accountId:
                          process.env.SLS_ACCOUNT_ID ||
                          "offlineContext_accountId",
                        apiKey:
                          process.env.SLS_API_KEY || "offlineContext_apiKey",
                        apiKeyId:
                          process.env.SLS_API_KEY_ID ||
                          "offlineContext_apiKeyId",
                        caller:
                          process.env.SLS_CALLER || "offlineContext_caller",
                        clientCert: null,
                        cognitoAuthenticationProvider:
                          simpleHeaders["cognito-authentication-provider"] ||
                          process.env.SLS_COGNITO_AUTHENTICATION_PROVIDER ||
                          "offlineContext_cognitoAuthenticationProvider",
                        cognitoAuthenticationType:
                          process.env.SLS_COGNITO_AUTHENTICATION_TYPE ||
                          "offlineContext_cognitoAuthenticationType",
                        cognitoIdentityId:
                          simpleHeaders["cognito-identity-id"] ||
                          process.env.SLS_COGNITO_IDENTITY_ID ||
                          "offlineContext_cognitoIdentityId",
                        cognitoIdentityPoolId:
                          process.env.SLS_COGNITO_IDENTITY_POOL_ID ||
                          "offlineContext_cognitoIdentityPoolId",
                        principalOrgId: null,
                        sourceIp: ip,
                        user: "offlineContext_user",
                        userAgent: simpleHeaders["user-agent"] || "",
                        userArn: "offlineContext_userArn",
                      },
                      path: route,
                      protocol: "HTTP/1.1",
                      requestId: cuid(),
                      requestTime: format(
                        executionTimeStarted,
                        "dd/MMM/yyyy:HH:mm:ss zzz"
                      ),
                      requestTimeEpoch: executionTimeStarted.valueOf(),
                      resourceId: "offlineContext_resourceId",
                      resourcePath: route,
                      stage: "dev",
                    },
                    resource: route,
                    stageVariables: null,
                  };
                  const context = generateContext({
                    functionName,
                    executionTimeStarted,
                  });

                  const result = handler(event, context, () => ({}));
                  return (result || Promise.resolve())
                    .then((result: APIGatewayProxyResult | void) => {
                      const executionTime = differenceInMilliseconds(
                        new Date(),
                        executionTimeStarted
                      );
                      console.log(
                        `Executed ${method} ${functionName} in ${executionTime}ms`
                      );
                      return result;
                    })
                    .then((result) => {
                      if (!result || typeof result.body !== "string") {
                        return res
                          .header("Content-Type", "application/json")
                          .status(502)
                          .json({
                            errorMessage: "Invalid body returned",
                            errorType: "INVALID_BODY",
                          });
                      }
                      Object.entries(result.headers || {}).forEach(([k, v]) =>
                        res.append(k, v.toString())
                      );
                      Object.entries(result.multiValueHeaders || {}).forEach(
                        ([k, vs]) =>
                          vs.forEach((v) => res.append(k, v.toString()))
                      );
                      res.status(result.statusCode || 200);
                      return result.isBase64Encoded
                        ? res
                            .setDefaultEncoding("binary")
                            .send(Buffer.from(result.body, "base64"))
                        : inlineTryCatch(
                            () => res.json(JSON.parse(result.body)),
                            () => res.send(result.body)
                          );
                    })
                    .catch((error: Error) => {
                      const message = error.message || error.toString();
                      console.error(message, "\n", error);
                      return res
                        .header("Content-Type", "application/json")
                        .status(502)
                        .json({
                          errorMessage: message,
                          errorType: error.constructor.name,
                          stackTrace: (error.stack || "")
                            .split("\n")
                            .map((l) => l.trim()),
                        });
                    });
                });
                if (method === "options") {
                  optionRoutes.add(route);
                }
              } else {
                // Mock Lambda
                app.post(route, (req, res) => {
                  const handler = handlersByRoute[functionName] as Handler<
                    Record<string, unknown>,
                    void
                  >;
                  if (typeof handler !== "function") {
                    return res
                      .header("Content-Type", "application/json")
                      .status(502)
                      .json({
                        errorMessage: `Could not find function handler for ${functionName}`,
                        errorType: "HANDLER_NOT_FOUND",
                      });
                  }
                  const event = req.body;
                  console.log(`Received Request async ${route}`);
                  const executionTimeStarted = new Date();
                  const context = generateContext({
                    functionName,
                    executionTimeStarted,
                  });
                  new Promise((resolve) =>
                    setTimeout(
                      () => resolve(handler(event, context, () => ({}))),
                      1
                    )
                  )
                    .then(() => {
                      const executionTime = differenceInMilliseconds(
                        new Date(),
                        executionTimeStarted
                      );
                      console.log(
                        `Executed async ${functionName} in ${executionTime}ms`
                      );
                    })
                    .catch((error: Error) => {
                      const message = error.message || error.toString();
                      console.error(message, "\n", error);
                    });
                  return res.status(202).json({});
                });
              }
              console.log(
                `Added Route ${
                  METHOD_SET.has(method) ? method.toUpperCase() : "POST"
                } ${route}`
              );
            }
            handlersByRoute[functionName] = handler;
            if (!optionRoutes.has(route)) {
              app.options(route, (req, res) =>
                res
                  .status(200)
                  .header(
                    "Access-Control-Allow-Headers",
                    req.headers["access-control-request-headers"]
                  )
                  .header("Access-Control-Allow-Origin", req.headers["origin"])
                  .header(
                    "Access-Control-Allow-Methods",
                    req.headers["access-control-request-method"]
                  )
                  .send()
              );
            }
            if (apiCount === ++currentCount) {
              resolve();
            }
          });
        },
        entryRegex,
      })
    ).then(() => {
      app.use((req, res) =>
        res
          .header("Access-Control-Allow-Origin", "*")
          .header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS"
          )
          .status(404)
          .json({
            currentRoute: `${req.method} - ${req.path}`,
            error: "Route not found.",
            statusCode: 404,
          })
      );
      const port = 3003;
      return setupServer({
        app,
        port,
        label: "App",
        ...(tunnel
          ? {
              onListen: () => {
                ngrok
                  .connect({
                    addr: port,
                    subdomain: tunnel,
                  })
                  .then((url) => {
                    console.log("Started local ngrok tunneling:");
                    console.log(url);
                    return 0;
                  });
              },
            }
          : {}),
      });
    });
  });
};

export default api;

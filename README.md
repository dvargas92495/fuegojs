# 🔥 FuegoJS 🔥

Opinionated static site generation framework built on [React](https://reactjs.org/), [Remix](https://remix.run/), and [AWS](https://aws.amazon.com/). The goal is to make your full stack web application and your experience developing it _blazing_ fast!

**Project is still under heavy development. APIs are subject to change and there are bugs. Lots of them.**.

The package exposes its commands as both a CLI and as a module to be imported in your script files. It's core commands could be thought of as the following 3x3 matrix:

+-----------+--------------+------------------+-----------------+
|    🔥     |   Develop    |     Package      |      Ship       |
+-----------+--------------+------------------+-----------------+
| Front End | `fuego dev`  |  `fuego build`   | `fuego deploy`  |
+-----------+--------------+------------------+-----------------+
| Back End  | `fuego api`  | `fuego compile`  | `fuego publish` |
+-----------+--------------+------------------+-----------------+
| Database  | `fuego sync` | `fuego generate` | `fuego migrate` |
+-----------+--------------+------------------+-----------------+

This table represents the goal. The documentation below and current api is out of date with this vision. Like I said, project is still under heavy development!

We will grow through each layer in the application, and within each outline the three core phases in development in each. There are also various utilities available to help along the way.

## Front End

The Front End is primarily built on [React](https://reactjs.org/) and [Remix](https://remix.run/). It offers an opinionated approach on how Remix apps should be built when targeting AWS Cloudfront, while also taking care of a lot of the boilerplate. Your entire front end should live in the `app` directory.

### `dev`

The `dev` command runs a local web server built by remix. The main build will be within the `server` directory while all the needed assets will be in the `public` directory. It watches for edits of your files in the `app` directory and automatically refreshes your browser's source on edit.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego dev
```

By default, the web server runs on `http://localhost:3000`.

### `build`

The `build` command packages your web application for production. There are two parts to your frontend that should be deployed to separate locations. First is the main Remix server file, which gets built to `out/index.js`. Then are all of the static assets, which are built to the `public/build` directory. You could generate any additional static assets you need to be within the `public` directory, as Remix builds everything it needs to the path mentioned above.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego build
```

The `build` command supports the following arguments:

- `--readable` - It builds a readable version of the main server file for help debugging issues in production.

### `deploy`

The `deploy` command performs two major steps. First, it publishes everything from the `public` directory to the configured `S3` bucket. Then, it compares a zip of the `out` directory with what's already deployed to the Origin Request Lambda that is already associated with your Cloudfront Distribution. If the hashes of the zips match, no further action will be taken. If it differs, than it means the function has changes and needs to be deployed:
- First, the zip of the `out` directory is uploaded to the lambda, with `index.js` renamed to `origin-request.js`.
- Then, CloudFront is updated to associate the new version on the lambda's code with the distribution. The command will wait for this to finish.
- Finally, Cloudfront will have a cache invalidation fired for the root `/*` paths. The command will wait for this. 

To use, simply add the following command as a script to your `package.json`:

```bash
fuego deploy
```

The `deploy` command supports the following arguments:

- `--domain [name]` - The domain name of your web application. By default, it sets the value to the name of your repository.

## Back end

The backend takes a serverless architecture approach, defining each file as a single function deployed to a single API path. It also supports deploying functions that are not part of your API but used for async processing.

### `api`

The `api` command runs a local api server that maps each of the functions built to the `build` directory to an API path. The function name should follow the same convention as the `build` command. For example, the function `example/get.ts` will create a path `GET /example` in the API server. It watches for edits of your functions in the `functions` directory and rebuilds the requisite `js` files on edit, remapping the server handler.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego api
```

By default, the api server runs on `http://localhost:3003`.

### `compile`

The `compile` command reads all of the serverless functions that make up your backend api and outputs them as `js` files in the `build` directory. It expects all of your functions to be in the `functions` directory in your repo. Each function file must be named after an HTTP method: `get.ts`, `post.ts`, `put.ts`, & `delete.ts`. The path they are found in map to the API path.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego compile
```

### `publish`

The `publish` command reads the files from the `build` directory and deploys them to various AWS Lambdas. It expects the names of the AWS Lambda functions to be `{NAME}_{FUNCTION}` where `NAME` is the name of your backend API and `FUNCTION` is the name of your function, delimiting the parts of path with `_` instead of `/`. Special characters in your name (e.g. `.`) will be replaced with a `-`.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego publish
```

The `publish` command supports the following arguments:

- `--name [name]` - The name of your backend API. By default, it sets the value to the name of your repository.

## Database

Coming Soon!

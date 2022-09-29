# 🔥 FuegoJS 🔥

Opinionated server-side rendering web framework built on [Remix](https://remix.run/) for [AWS](https://aws.amazon.com/), using [Terraform](https://www.terraform.io/). The goal is to make your full stack web application and your experience developing it _blazing_ fast! All configuration come with opinionated defaults.

**Project is still under heavy development. APIs are subject to change and there are bugs. Lots of them.**.

The package exposes its commands as both a CLI and as a module to be imported in your script files. It's core commands could be thought of as the following matrix:

```
+-------+---------------+-----------------+-----------------+
|  🔥   |  Develop      |   Package       |      Ship       |
+-------+---------------+-----------------+-----------------+
| APP   | `fuego dev`   | `fuego build`   | `fuego deploy`  |
+-------+---------------+-----------------+-----------------+
| API   | `fuego api`   | `fuego compile` | `fuego upgrade` |
+-------+---------------+-----------------+-----------------+
| DATA  | `fuego sync`  | `fuego plan`    | `fuego apply`   |
+-------+---------------+-----------------+-----------------+
| NPM   | `fuego node`  | `fuego package` | `fuego publish` |
+-------+---------------+-----------------+-----------------+
| TESTS | `fuego watch` | `fuego test`    | `fuego report`  |
+-------+---------------+-----------------+-----------------+
```
<!-- coming soon: game, web3, mobile -->
<!-- web3 might be part of data? I think so -->

This table represents the goal. The left column represents the potential _targets_ of where your code gets shipped. Each target is a parent directory in a `fuego` repo. The following three columns represent the three core phases of the development cycle. The documentation below represents the current API which has not yet reached this vision. Project is still under heavy development!

We will go through each layer in the application, and within each outline the three core phases in development in each. There are also various utilities available to help along the way.

## APP

The APP is primarily built on [Remix](https://remix.run/). It offers an opinionated approach on how Remix apps should be built when targeting AWS Cloudfront, while also taking care of a lot of the boilerplate. Your entire front end should live in the `app` directory.

### `dev`

The `dev` command is a light wrapper around the [Remix Dev command](https://remix.run/docs/en/v1/other-api/dev#remix-dev).

```bash
fuego dev
```

It supports the following arguments:

- `--port [number]` - Sets the `PORT` environment variable that the Remix development server uses to run on. Default: **3000**

### `build`

The `build` command is a light wrapper adound the [Remix Build command](https://remix.run/docs/en/v1/other-api/dev#remix-dev). Because Remix doesn't currently support interpolating environment variables through something like a [dotenv](https://www.npmjs.com/package/dotenv) plugin, this command will run a second [esbuild](https://esbuild.github.io/) after the Remix one to interpolate those values, which gets built to the `out/index.js`.

The command expects all app files to be within the `/app` directory. This _includes_ the adapter file that Remix usually advises to keep in the root `server` folder, Fuego expects the file to be in the `app/server` directory. This is to follow the `Fuego` principle that each top level directory represents a different destination that code is shipped to.

Public assets are currently expected in the root `public` directory, built to `public/build`. This is expected to migrate to `app/public` and `app/public/build` in a future version.

```bash
fuego build
```

The `build` command supports the following arguments:

- `--readable` - It builds a readable version of the main server file for help debugging issues. Default: **false**

### `deploy`

The `deploy` command performs two major steps. First, it publishes everything from the `public` directory to the configured `S3` bucket. Then, it compares a zip of the `out` directory with what's already deployed to the Origin Request Lambda associated with your Cloudfront Distribution. If the hashes of the zips match, no further action will be taken. If it differs, than it means the function has changes and needs to be deployed:
- First, the zip of the `out` directory is uploaded to the lambda, with `index.js` renamed to `origin-request.js`.
- Then, CloudFront is updated to associate the new version of the lambda's code with the distribution. The command will wait for this to finish.

```bash
fuego deploy
```

The `deploy` command supports the following arguments:

- `--domain [name]` - The domain name of your web application. By default, it sets the value to the name of your repository.

## API

The API takes a serverless architecture approach, defining each file as a single function deployed to a single API path. It also supports deploying functions that are not part of your API but used for async processing. Because the APP above already includes its own backend, functions defined in API are meant to be accessible by other applications, not your APP.

### `api`

The `api` command runs a local api server that maps each of the functions built to the `build` directory to an API path. For example, the function `example/get.ts` will create a path `GET /example` in the API server. Functions defined at the root of the folder will be reachable at `POST /[name]`. It watches for edits of your functions in the `api` directory and rebuilds the requisite `js` files on edit, remapping the server handler. Each function should be exported as the `handler` named method.

```bash
fuego api
```

The `api` command supports the following arguments:

- `--tunnel [domain]` - Uses [ngrok](https://ngrok.com/) to create a public URL gateway that tunnels into your API, useful for testing webhooks. Off by default.
- `--port [number]` - The port your API will run on locally. Default: **3003**

### `compile`

The `compile` command reads all of the serverless functions that make up your backend api and outputs them as `js` files in the `build` directory. It expects all of your functions to be in the `api` directory in your repo. Each function file within a path must be named after an HTTP method: `get.ts`, `post.ts`, `put.ts`, & `delete.ts`. Functions found in the root could be named anything and will be deployed as background lambda functions.

```bash
fuego compile
```

The `compile` command supports the following arguments:

- `--readable` - It builds a readable version of the main server file for help debugging issues. Default: **false**
- `--path [name]` - The name of the root directory where you function files can be found in. Default: **api**

### `publish`

The `publish` command reads the files from the `build` directory and deploys them to various AWS Lambdas. It expects the names of the AWS Lambda functions to be `{NAME}_{FUNCTION}` where `NAME` is the name of your backend API and `FUNCTION` is the name of your function, delimiting the parts of path with `-` instead of `/`. Special characters in `NAME` (e.g. `.`) will be replaced with a `-`.

```bash
fuego publish
```

The `publish` command supports the following arguments:

- `--name [name]` - The name of your backend API. By default, it sets the value to the name of your repository.

## DATA

Most libraries that help manage your data assume a single data source - your database. Fuego takes the approach that the data in your application does live in multiple places and having all of those schemas version controlled in your codebase is the best way to keep track on how it evolves with your application. Schemas should be defined declaritively, allowing Fuego to reconcile differences automatically. The heavy lifting for this reconciliation is mostly done by [Terraform](https://terraform.io). Fuego custom migrations are allowed as an escape hatch for anything not defined declaritively.

### `sync`

Coming Soon! Currently requires running `npx fuego migrate` locally.

### `plan`

Coming Soon! See `npx fuego migrate --generate` below.

### `apply`

Coming Soon! See `npx fuego migrate` below.

### `migrate`

The `migrate` command that exists today allows users to define custom one time scripts to run on either their development or production environments. Migration files are currently expected to be in the `data/migrations` root directory. It also expects a `DATABASE_URL` environment variable to be defined to track migrations applied with `mysql`. Migration files themselves can be in typescript and should expose a `migrate` and `revert` functions, run while applying and reverting the migration respectively. Typescript allow migrations to include database migrations via sql queries and third party service data via API calls.

Migrations should be viewed as an escape hatch for one time scripts run on production. There's almost always a better approach:
- Schema migrations should instead be defined as Schema files (_coming soon!_)
- Data migrations should instead be features in your application that could be run by users or admin

```bash
npx fuego migrate
```

The `migrate` command supports the following arguments:

- `--generate [name]` - Creates a migration file in `yyyy-MM-dd-hh-mm-name.ts` format instead of running migrations.
- `--revert [number]` - Reverts the last `number` of migration files instead of running migrations. No argument defaults `number` to 1.
- `--overwrite [name]` - Overwrites the checksum of the migration file specified by name in case any changes are made, before running migrations. By default, if fuego detects differences in checksum, the migration will be rejected. Could specify any number of overwrite arguments.

In the future, this command will evolve to running migration files that are automatically generated from the `generate` command above during schema reconciliation.

## Miscellaneous

The following commands are also accessible for help developing with Fuego.

### `postinstall`

There are a few features not yet available in related libraries for Fuego to run in the way it would like to. We inject these features during NPM's postinstall process so that we could smooth over usage until the related libraries implement them directly. To utilize, please add the following to your `package.json` within the `scripts` object:

```bash
postinstall: fuego postinstall
```

You should pass in as arguments any package that is exports as `ESM`. Remix doesn't have a great way of handling this so the post install will convert the package to `CJS` using `esbuild`.

### `init`

This is the only global command meant to create a new project from scratch. It uses [Remix Stacks](https://remix.run/docs/en/v1/pages/stacks) under the hood allowing you to pass in any existing GitHub stack template. It will also use the input domain as the name for the generated repository and all other name related parameters.

```
npm install -g fuegojs@latest
npx fuego init --domain example.com
```

This command takes in the following arguments:
- `--domain [name]` - **REQUIRED** The domain where your app will be hosted. The name will be used for your Github repo and several other naming conventions.
- `--template [name]` - The Remix Stack to use for initialization. By default, it will use `dvargas92596/fuegojs/tree/main/template`, which points to the Remix stack located in the `/template` directory in this repository.
    - **Note:** - The template is currently very custom to my apps ("Vargas Arts" branding and such), and I will be working to make it more generic in the coming versions.

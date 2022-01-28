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

## Build

The `build` command outputs your web application as `html` files in the `out` directory. It expects all of your pages to be in the `pages` directory in your repo.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego build
```

## Deploy

The `deploy` command reads the files from the `out` directory and deploys them to an S3 bucket in AWS. It expects the S3 bucket to be of the same name as your website domain.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego deploy
```

The `deploy` command supports the following arguments:

- `--domain [name]` - The domain name of your web application. By default, it sets the value to the name of your repository.

## FE

The `fe` command runs a local web server that serves the `html` files that get built to the `out` directory. It watches for edits of your pages to be in the `pages` directory and rebuilds the requisite `html` files on edit.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego fe
```

By default, the web server runs on `http://localhost:3000`.

## Compile

The `compile` command reads all of the serverless functions that make up your backend api and outputs them as `js` files in the `build` directory. It expects all of your functions to be in the `functions` directory in your repo. Each function file must be named after an HTTP method: `get.ts`, `post.ts`, `put.ts`, & `delete.ts`. The path they are found in map to the API path.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego compile
```

## Publish

The `publish` command reads the files from the `build` directory and deploys them to various AWS Lambdas. It expects the names of the AWS Lambda functions to be `{NAME}_{FUNCTION}` where `NAME` is the name of your backend API and `FUNCTION` is the name of your function, delimiting the parts of path with `_` instead of `/`. Special characters in your name (e.g. `.`) will be replaced with a `-`.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego publish
```

The `publish` command supports the following arguments:

- `--name [name]` - The name of your backend API. By default, it sets the value to the name of your repository.

## API

The `api` command runs a local api server that maps each of the functions built to the `build` directory to an API path. The function name should follow the same convention as the `build` command. For example, the function `example/get.ts` will create a path `GET /example` in the API server. It watches for edits of your functions in the `functions` directory and rebuilds the requisite `js` files on edit, remapping the server handler.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego api
```

By default, the api server runs on `http://localhost:3003`.

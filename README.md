# 🔥 FuegoJS 🔥

Opinionated static site generation framework built on [React](https://reactjs.org/), [Esbuild](https://esbuild.github.io/), and [AWS](https://aws.amazon.com/). The goal is to make your full stack web application and your experience developing it _blazing_ fast!

**Project is still under heavy development. APIs are subject to change and there are bugs. Lots of them.**.

The package exposes its commands as both a CLI and as a module to be imported in your script files.

## Build

The build command outputs your web application as `html` files in the `out` directory. It expects all of your pages to be in the `pages` directory in your repo.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego build
```

## Deploy

The deploy command reads the files from the `out` directory and deploys them to an S3 bucket in AWS. It expects the S3 bucket to be of the same name as your website domain.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego deploy
```

The deploy command supports the following arguments:

- `--domain [name]` - The domain name of your web application. By default, it sets the value to the name of your repository.

## Migrate

The migrate command reads the typescript file stored in `db/schema.ts` and translates it to a `mysql` migration. This allows you to define your `mysql` schema in a declarative way. Once loaded, the command will compare the schema you defined with the one online and apply the changes accordingly.

To use, simply add the following command as a script to your `package.json`:

```bash
fuego migrate
```

The migrate command supports the following arguments:

- `--host [endpoint]` - The endpoint hosting your mysql instance. By default, it sets the value based on what's stored in the `DB_HOST` environment variable.
- `--port [port]` - The port your mysql instance is listening to. By default, it sets the value based on what's stored in the `DB_PORT` environment variable.
- `--user [name]` - The mysql username that has access to the schema. By default, it sets the value based on what's stored in the `DB_USER` environment variable.
- `--password [pw]` - The password for the given mysql user. By default, it sets the value based on what's stored in the `DB_PASSWORD` environment variable. Using the environment variable is the recommended way for this argument.
- `--db [name]` - The name of the schema you are looking to access. By default, it sets the value based on what's stored in the `DB_NAME` environment variable.

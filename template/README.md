# {{{projectName}}}

Accessible at [https://{{{projectName}}}](https://{{{projectName}}}). 

{{{description}}}.

## Setup

1. Fork the repository to your GitHub account.
1. Clone the repository locally.
1. Install dependencies with `npm install`.
1. Copy the `.env.default` file to `.env`, and replace the values that are marked `TODO`
    1. `CLERK_API_KEY` - Get from `@dvargas92495`
    1. `DATABASE_URL` - Be sure to have a local instance of mysql running and fill in the URL to access it here
    1. (SKIP FOR NOW) - `STRIPE_SECRET` - Get from `@dvargas92495`
    1. (SKIP FOR NOW) - `STRIPE_WEBHOOK_SECRET` - Get from `@dvargas92495`
1. `npm start` to run the app

## Contributing

1. Create a new branch locally
1. When ready, create a pull request that targets the `main` branch of the original repository
1. When ready, tag `@dvargas92495` for review

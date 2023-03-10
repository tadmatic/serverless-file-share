## AWS CDK boilerplate project for a simple cron job

Includes:
* ESLint/Prettier config - to ensure code style consistency
* Lambda power tools for logging, metrics and tracing
* Automated tests using jest

### Getting started
**Step 1: Install dependencies**
```
yarn # or npm install
```

**Step 2: Create an environment file** 
In the project root folder create a file called ``.env``
Refer to ``.env.sample`` for reference.

Additional environments can be set up using the format ``.env.<environment_name>``, e.g. ``.env.prod``, ``.env.staging``

**Step 3: Set AWS_PROFILE environment variable (optional)**
If you don't want to use the default AWS profile and use a specific profile, set an environment variable:
```
AWS_PROFILE=myProfile
```

### Commands
#### Build CDK package
```
yarn build
```

#### Build CDK package using .env.prod config
```
yarn build:prod
```

#### Deploy to AWS
```
yarn deploy
```

#### Deploy to prod using .env.prod config
```
yarn deploy:prod
```

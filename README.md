## AWS CDK boilerplate project for a simple cron job

Includes:
* ESLint/Prettier config - to ensure code style consistency
* Lambda power tools for logging, metrics and tracing
* Automated tests using jest

### Getting started
1. Setup AWS profile in package.json
```
  "config": {
    "awsProfile": "default"
  },
```

2. Create environment files - .env and .env.prod in project root director.

Refer to .env.sample for reference

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

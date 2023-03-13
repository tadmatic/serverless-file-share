## Serverless File Share Solution on AWS

### Getting started
**Step 1: Install dependencies**
```
yarn # or npm install
```

**Step 2: Setup AWS profile (optional)** 

If you don't want to use the default AWS profile and use a specific profile, set an environment variable:

```
AWS_PROFILE=myProfile
```

In the project root folder create a file called ``.env`` and include the above.

### Commands

#### Build CDK package

Will generate CloudFormation template and compiled Lambda code.

```
yarn build
```

#### Deploy to AWS

Will build and deploy to AWS.

```
yarn deploy
```

#### For prod build/deployment

Will use environment variables in ```.env.prod``` instead of ```.env```

```
yarn build:prod
yarn deploy:prod
```

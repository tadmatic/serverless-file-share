## Serverless File Share Solution on AWS

---

### Before you get started
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

**Step 3: Give your app a unique name** 

When the app is deployed, it will attempt to create a Cognito user pool. The name of the pool must be globally unique (at a region level).

The app name is based on the ```name``` attribute in ```package.json```. Update this attribute to use a unique name otherwise deployment will fail.  

---

### Building & Deploying

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

---

### API Specification

**```/download/{filepath}```**

Will redirect to an S3 presigned URL after first checking if the user is logged in to Cognito and is allowed to access the file.

If the user is not logged into Cognito, they will be redirected to the Cognito Hosted UI login screen.

**```/logout```**

Logout of Cognito and clear session/cookies.

---

### TODO List

1\. Add eligibility checks after authentication - e.g. has user reached their download quota

2\. Refactor download lambda function into an express step function:
* Step 1: Validate access token
* Step 2: Eligibility checks (dynamodb)
* Step 3: Record download
* Step 4: Generate presigned URL

3\. Work out if there is a way to redirect to presigned URL without changing the URL in the browser (i.e. keep user on API gateway url)

4\. Resolve API URL circular dependency to get rid of ugly code (e.g. hardcoding of /prod folder prefix)

5\. Add share functionality:
* API inputs - filepath, user to share with, permissions, number of downloads allowed, flag for whether an email notification should be sent
* Express step function:
* Step 1: Record permissions to database
* Step 2: If email flag present, send email via SNS/SES

6\. Add upload functionality?? upload directly to S3 or via API/Lambda?

7\. Add detailed observability metrics and reporting - e.g. how many downloads per user

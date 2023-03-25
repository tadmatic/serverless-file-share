import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps, aws_lambda_nodejs } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

// get application name from package.json
import * as packageJson from '../package.json';
const APPLICATION_NAME = packageJson.name;

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create an S3 bucket to store the files
    const bucket = new s3.Bucket(this, 'DownloadBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create a DynamoDB table to record download requests
    const table = new dynamodb.Table(this, 'DownloadTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create a Cognito user pool
    const userPool = new cognito.UserPool(this, 'MyUserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
    });

    // Add a domain prefix to enable Cognito Hosted UI
    userPool.addDomain('MyUserPoolDomain', {
      cognitoDomain: {
        domainPrefix: APPLICATION_NAME,
      },
    });

    // Create log group for API gateway
    const apiLogGroup = new logs.LogGroup(this, 'DownloadAPIAccessLog', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create an API Gateway to expose the Lambda function
    const api = new apigateway.RestApi(this, 'DownloadAPI', {
      restApiName: APPLICATION_NAME,
      description: 'API for downloading files from S3',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      deployOptions: {
        stageName: 'prod',
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    // Create a Cognito user pool client
    const userPoolClient = new cognito.UserPoolClient(this, 'MyUserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        callbackUrls: [`https://${api.restApiId}.execute-api.${cdk.Aws.REGION}.amazonaws.com/prod/auth_callback`],
      },
    });

    // Create a Cognito identity pool
    new cognito.CfnIdentityPool(this, 'MyIdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    // Declare environment variables for Lambda functions
    const environment = {
      AWS_ACCOUNT_ID: Stack.of(this).account,
      POWERTOOLS_SERVICE_NAME: APPLICATION_NAME,
      POWERTOOLS_LOGGER_LOG_LEVEL: 'WARN',
      POWERTOOLS_LOGGER_SAMPLE_RATE: '0.01',
      POWERTOOLS_LOGGER_LOG_EVENT: 'true',
      POWERTOOLS_METRICS_NAMESPACE: APPLICATION_NAME,
      BUCKET_NAME: bucket.bucketName,
      TABLE_NAME: table.tableName,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      COGNITO_BASE_URL: `https://${APPLICATION_NAME}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
    };

    // Global lambda settings
    const functionSettings = {
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 256,
      environment,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
      },
      awsSdkConnectionReuse: true,
      timeout: Duration.seconds(30),
    };

    // Create a Lambda function to handle download requests
    const downloadFunction = new aws_lambda_nodejs.NodejsFunction(this, 'DownloadFunction', {
      entry: './src/functions/download.ts',
      ...functionSettings,
    });

    // Grant the Lambda function read access to the S3 bucket
    bucket.grantRead(downloadFunction);

    // Grant the Lambda function write access to the DynamoDB table
    table.grantWriteData(downloadFunction);

    // Create a Lambda function to handle Cognito auth callback
    const authCallbackFunction = new aws_lambda_nodejs.NodejsFunction(this, 'AuthCallbackFunction', {
      entry: './src/functions/authCallback.ts',
      ...functionSettings,
    });

    // Create a Lambda function to handle Cognito auth callback
    const loginFunction = new aws_lambda_nodejs.NodejsFunction(this, 'LoginFunction', {
      entry: './src/functions/login.ts',
      ...functionSettings,
    });

    // Create a Cognito authorizer for the API Gateway
    const authorizer = new apigateway.CfnAuthorizer(this, 'MyAuthorizer', {
      name: 'MyAuthorizer',
      identitySource: 'method.request.header.Authorization',
      providerArns: [userPool.userPoolArn],
      restApiId: api.restApiId,
      type: apigateway.AuthorizationType.COGNITO,
    });

    // Define the "/download/{filepath+}" route
    api.root
      .addResource('download')
      .addResource('{filepath+}')
      .addMethod('GET', new apigateway.LambdaIntegration(downloadFunction), {
        authorizer: {
          authorizerId: authorizer.ref,
        },
      });

    // Define the /auth_callback route
    api.root.addResource('auth_callback').addMethod('GET', new apigateway.LambdaIntegration(authCallbackFunction));

    // Define the /login route
    api.root.addResource('login').addMethod('GET', new apigateway.LambdaIntegration(loginFunction));

    // Output variables
    new cdk.CfnOutput(this, 'DownloadIntegrationUri', {
      value: api.url,
      description: 'API URL',
    });
  }
}

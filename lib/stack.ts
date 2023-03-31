import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps, aws_lambda_nodejs } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke, Mode } from 'aws-cdk-lib/aws-stepfunctions-tasks';
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
        tracingEnabled: true,
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
        logoutUrls: [`https://${api.restApiId}.execute-api.${cdk.Aws.REGION}.amazonaws.com/prod/logout_callback`],
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
      // API_URL: api.url <-- causes circular dependency (ffs)
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

    // Create a Lambda function to handle logout
    const logoutFunction = new aws_lambda_nodejs.NodejsFunction(this, 'LogoutFunction', {
      entry: './src/functions/logout.ts',
      ...functionSettings,
    });

    // Create a Lambda function to handle logout callback
    const logoutCallbackFunction = new aws_lambda_nodejs.NodejsFunction(this, 'LogoutCallbackFunction', {
      entry: './src/functions/logoutCallback.ts',
      ...functionSettings,
    });

    // Create download state machine
    const downloadStateMachine = new sfn.StateMachine(this, 'CDKStateMachine', {
      definition: sfn.Chain.start(
          new LambdaInvoke(this, 'downloadTask', { lambdaFunction: downloadFunction, 
            payloadResponseOnly:true,
            payload: sfn.TaskInput.fromObject({
              "id":sfn.JsonPath.stringAt("$.header.X-Amzn-Trace-Id"),
              "cookie": sfn.JsonPath.stringAt("$.header.cookie"),
              "filepath": sfn.JsonPath.stringAt("$.path.filepath"),
              "host": sfn.JsonPath.stringAt("$.header.Host")
        })})
      ),
      stateMachineType: sfn.StateMachineType.EXPRESS,
    });

    // Add the required IAM permissions for the authorizer function
    logoutFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GlobalSignOut'],
        resources: [
          `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/${userPool.userPoolId}`,
          `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/${userPool.userPoolId}/client/${userPoolClient.userPoolClientId}`,
        ],
      }),
    );

    /*
    // Create a Lambda function to handle Cognito auth callback
    const authorizerFunction = new aws_lambda_nodejs.NodejsFunction(this, 'AuthorizerFunction', {
      entry: './src/functions/authorizer.ts',
      ...functionSettings,
    });

    // Add the required IAM permissions for the authorizer function
    authorizerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:GetUser'],
        resources: [
          `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/${userPool.userPoolId}`,
          `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/${userPool.userPoolId}/client/${userPoolClient.userPoolClientId}`,
        ],
      }),
    );

    // Create a Cognito authorizer for the API Gateway
    const authorizer = new apigateway.RequestAuthorizer(this, 'MyAuthorizer', {
      handler: authorizerFunction,
      identitySources: [],
      resultsCacheTtl: Duration.seconds(0),
    });
    */

    api.root
      .addResource('download')
      .addResource('{filepath+}')
      .addMethod('GET', apigateway.StepFunctionsIntegration.startExecution(downloadStateMachine, {
        headers:true,
        authorizer:true
      }));
      /* //TODO ie to fix the response mapping
      const responseModel = api.addModel('Response', {
        schema: {
          type: apigateway.JsonSchemaType.STRING
        }
      });
      resource.addMethodResponse({statusCode:"200", responseModels:{"text/plain":responseModel}});
      resource.addMethodResponse({statusCode:"307", responseModels:{"text/plain":responseModel}})
      resource.addMethodResponse({statusCode:"302", responseModels:{"text/plain":responseModel}})
      */
    
    // Define the /auth_callback route
    api.root.addResource('auth_callback').addMethod('GET', new apigateway.LambdaIntegration(authCallbackFunction));

    // Define the /login route
    api.root.addResource('login').addMethod('GET', new apigateway.LambdaIntegration(loginFunction));

    // Define the /logout route
    api.root.addResource('logout').addMethod('GET', new apigateway.LambdaIntegration(logoutFunction));

    // Define the /logout_callback route
    api.root.addResource('logout_callback').addMethod('GET', new apigateway.LambdaIntegration(logoutCallbackFunction));

    // Output variables
    new cdk.CfnOutput(this, 'DownloadIntegrationUri', {
      value: api.url,
      description: 'API URL',
    });
  }
}

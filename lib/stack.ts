import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps, aws_lambda_nodejs } from 'aws-cdk-lib';
import { aws_glue as glue } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
// import * as crypto from 'crypto';

// get application name from package.json
import * as packageJson from '../package.json';
const APPLICATION_NAME = packageJson.name;

// include random bytes in domain name to ensure globally unique domain prefix is used
const COGNITO_DOMAIN_PREFIX = `${APPLICATION_NAME}`; // -${crypto.randomBytes(8).toString('hex')}`;

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /*-------------------------------
     * Set up S3 buckets
     -------------------------------*/

    // Create an S3 bucket to store S3 access logs
    const loggingBucket = new s3.Bucket(this, 'LoggingBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: change to retain
    });

    // Create S3 analytics bucket for Athena
    const analyticsBucket = new s3.Bucket(this, `AnalyticsBucket`, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY, // TODO: change to retain
    });

    // Create an S3 bucket to store the files to share/download
    const bucket = new s3.Bucket(this, 'DownloadBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: change to retain
      // enable s3 access logs
      serverAccessLogsBucket: loggingBucket,
      serverAccessLogsPrefix: 'access-logs/',
    });

    /*-------------------------------
     * Set up Dynamo DB table
     -------------------------------*/

    // Create a DynamoDB table to record download requests
    const table = new dynamodb.Table(this, 'DownloadTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /*-------------------------------
     * Set up API gateway
     -------------------------------*/

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

    /*-------------------------------
     * Set up Cognito for authentication
     -------------------------------*/

    // Create a Cognito user pool
    const userPool = new cognito.UserPool(this, 'MyUserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
    });

    // Add a domain prefix to enable Cognito Hosted UI
    userPool.addDomain('MyUserPoolDomain', {
      cognitoDomain: {
        domainPrefix: COGNITO_DOMAIN_PREFIX,
      },
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

    /*-------------------------------
     * Set up Lambda functions
     -------------------------------*/

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
      COGNITO_BASE_URL: `https://${COGNITO_DOMAIN_PREFIX}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      REGION: this.region,
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

    /*-------------------------------
     * Set up cookie based custom Lambda authorizer
     -------------------------------*/

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

    /*-------------------------------
     * Set up API Gateway routes
     -------------------------------*/

    // Define the "/download/{filepath+}" route
    api.root
      .addResource('download')
      .addResource('{filepath+}')
      .addMethod('GET', new apigateway.LambdaIntegration(downloadFunction));

    // Define the /auth_callback route
    api.root.addResource('auth_callback').addMethod('GET', new apigateway.LambdaIntegration(authCallbackFunction));

    // Define the /login route
    api.root.addResource('login').addMethod('GET', new apigateway.LambdaIntegration(loginFunction));

    // Define the /logout route
    api.root.addResource('logout').addMethod('GET', new apigateway.LambdaIntegration(logoutFunction));

    // Define the /logout_callback route
    api.root.addResource('logout_callback').addMethod('GET', new apigateway.LambdaIntegration(logoutCallbackFunction));

    /*-------------------------------
     * Set up download analytics using Athena and Glue
     -------------------------------*/

    // Create a new Glue database for storing S3 access logs
    const glueDb = new glue.CfnDatabase(this, 'access_logs_database', {
      catalogId: this.account,
      databaseInput: {
        name: 'access_logs_database',
        locationUri: `s3://${analyticsBucket.bucketName}`,
        description: 'Glue database to enable Athena queries',
      },
    });

    /*
    const role = new iam.Role(this, 'GlueCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:ListBucket',
          'glue:GetConnection',
          'glue:GetDatabase',
          'glue:CreateTable',
          'glue:BatchCreatePartition',
          'glue:CreateDatabase',
        ],
        resources: [loggingBucket.bucketArn, `arn:${cdk.Aws.PARTITION}:s3:::${loggingBucket.bucketName}/*`],
      }),
    );
    */

    // Create a new Glue table for storing S3 access logs
    new glue.CfnTable(this, 'access_logs_table', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseName: glueDb.ref,
      tableInput: {
        name: 'access_logs',
        storageDescriptor: {
          columns: [
            { name: 'bucket_owner', type: 'string' },
            { name: 'bucket', type: 'string' },
            { name: 'request_datetime', type: 'string' },
            { name: 'remote_ip', type: 'string' },
            { name: 'requester', type: 'string' },
            { name: 'request_id', type: 'string' },
            { name: 'operation', type: 'string' },
            { name: 'key', type: 'string' },
            { name: 'request_uri', type: 'string' },
            { name: 'http_status', type: 'int' },
            { name: 'error_code', type: 'string' },
            { name: 'bytes_sent', type: 'bigint' },
            { name: 'object_size', type: 'bigint' },
            { name: 'total_time', type: 'int' },
            { name: 'turn_around_time', type: 'int' },
            { name: 'referrer', type: 'string' },
            { name: 'user_agent', type: 'string' },
            { name: 'version_id', type: 'string' },
            { name: 'host_id', type: 'string' },
            { name: 'sigv', type: 'string' },
            { name: 'cipher_suite', type: 'string' },
            { name: 'auth_type', type: 'string' },
            { name: 'endpoint', type: 'string' },
            { name: 'tlsversion', type: 'string' },
          ],
          location: `s3://${loggingBucket.bucketName}/access-logs`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.RegexSerDe',
            parameters: {
              'input.regex':
                '([^ ]*) ([^ ]*) \\[(.*?)\\] ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) (\\"[^"]*\\"|-) (-|[0-9]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) (\\"[^"]*\\"|-) ([^ ]*)(?: ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*))?.*$',
            },
          },
        },
      },
    });

    const viewQuery = `
      CREATE OR REPLACE VIEW download_report AS
      SELECT
          request_datetime,
          REGEXP_EXTRACT(URL_DECODE(request_uri), 'x-amz-email=([^& ]+)', 1) as email,
          key,
          bytes_sent
      FROM
          access_logs
      WHERE
          operation = 'REST.GET.OBJECT'
          AND http_status = 200
      ORDER BY
          request_datetime
    `;

    const createPrestoView = (query: string): string => {
      return `/* Presto View: ${new Buffer(query).toString('base64')} */`;
    };

    new glue.CfnTable(this, 'DownloadReport', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseName: glueDb.ref,
      tableInput: {
        name: 'download_report',
        tableType: 'VIRTUAL_VIEW',
        parameters: {
          classification: 'parquet',
          presto_view: true,
        },
        viewOriginalText: createPrestoView(viewQuery),
        viewExpandedText: viewQuery,
        storageDescriptor: {
          columns: [
            { name: 'request_datetime', type: 'string' },
            { name: 'email', type: 'string' },
            { name: 'key', type: 'string' },
            { name: 'http_status', type: 'int' },
            { name: 'bytes_sent', type: 'bigint' },
          ],
        },
      },
    });

    /*
    new tasks.AthenaStartQueryExecution(this, 'AthenaViewQuery', {
      queryString: `
        CREATE OR REPLACE VIEW download_report AS
        SELECT
            request_datetime,
            REGEXP_EXTRACT(URL_DECODE(request_uri), 'x-amz-email=([^& ]+)', 1) as email,
            key,
            http_status,
            bytes_sent
        FROM
            "AwsDataCatalog"."access_logs_database"."access_logs"
        WHERE
            operation = 'REST.GET.OBJECT'
        ORDER BY
            request_datetime
      `,
      queryExecutionContext: {
        databaseName: glueDb.ref,
      },
      outputPath: `s3://${analyticsBucket.bucketName}`,
    });
    */

    /*
    const workGroup = new athena.CfnWorkGroup(this, 'AthenaWorkGroup', {
      name: APPLICATION_NAME,
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${analyticsBucket.bucketName}`,
        },
      },
    });

    const view = new athena.CfnNamedQuery(this, 'DownloadReportView', {
      database: glueDb.ref,
      workGroup: workGroup.ref,
      name: 'download_report',
      queryString: `
        CREATE OR REPLACE VIEW download_report AS
        SELECT
            request_datetime,
            REGEXP_EXTRACT(URL_DECODE(request_uri), 'x-amz-email=([^& ]+)', 1) as email,
            key,
            http_status,
            bytes_sent
        FROM
            access_logs
        WHERE
            operation = 'REST.GET.OBJECT'
        ORDER BY
            request_datetime
      `,
    });
    */

    // Output variables
    new cdk.CfnOutput(this, 'DownloadIntegrationUri', {
      value: api.url,
      description: 'API URL',
    });
  }
}

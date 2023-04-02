import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps, aws_lambda_nodejs } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

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
      partitionKey: { name: 'filepath', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'record', type: dynamodb.AttributeType.STRING },
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
    
    // Create a Lambda function to handle external share requests
    const startShareFunction = new aws_lambda_nodejs.NodejsFunction(this, 'startShareFunction', {
      entry: './src/functions/external_share/process.ts',
      ...functionSettings,
    });
    const generateShareURLFunction = new aws_lambda_nodejs.NodejsFunction(this, 'generateShareURLFunction', {
      entry: './src/functions/external_share/url.ts',
      ...functionSettings,
    });
    const recordShareFunction = new aws_lambda_nodejs.NodejsFunction(this, 'recordShareFunction', {
      entry: './src/functions/external_share/record.ts',
      ...functionSettings,
    });
    table.grantWriteData(recordShareFunction);
    const notifyShareFunction = new aws_lambda_nodejs.NodejsFunction(this, 'notifyShareFunction', {
      entry: './src/functions/external_share/notify.ts',
      ...functionSettings,
    });
    const endShareFunction = new aws_lambda_nodejs.NodejsFunction(this, 'endShareFunction', {
      entry: './src/functions/external_share/complete.ts',
      ...functionSettings,
    });

    // Create a Lambda function to handle download requests
    const startDownloadFunction = new aws_lambda_nodejs.NodejsFunction(this, 'startDownloadFunction', {
      entry: './src/functions/download/process.ts',
      ...functionSettings,
    });
    const eligibleDownloadFunction = new aws_lambda_nodejs.NodejsFunction(this, 'eligibleDownloadFunction', {
      entry: './src/functions/download/eligible.ts',
      ...functionSettings,
    });
    const generateDownloadURLFunction = new aws_lambda_nodejs.NodejsFunction(this, 'generateDownloadURLFunction', {
      entry: './src/functions/download/url.ts',
      ...functionSettings,
    });
    bucket.grantRead(generateDownloadURLFunction);
    table.grantReadWriteData(generateDownloadURLFunction);
    const recordDownloadFunction = new aws_lambda_nodejs.NodejsFunction(this, 'recordDownloadFunction', {
      entry: './src/functions/download/record.ts',
      ...functionSettings,
    });
    table.grantWriteData(recordDownloadFunction);
    const endDownloadFunction = new aws_lambda_nodejs.NodejsFunction(this, 'endDownloadFunction', {
      entry: './src/functions/download/complete.ts',
      ...functionSettings,
    });

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

    /*-------------------------------
     * Set up External Share step function
     -------------------------------*/
     const startShareInvocation = new LambdaInvoke(this, 'Validate Share', {
      lambdaFunction: startShareFunction,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        id: sfn.JsonPath.stringAt('$.header.X-Amzn-Trace-Id'),
        userId: sfn.JsonPath.stringAt('$.authorizer.principalId'),        
        presignedUrl: sfn.JsonPath.stringAt('$.querystring.url'),
        shareUserId: sfn.JsonPath.stringAt('$.querystring.email'),
        maxNumberOfDownloads: sfn.JsonPath.stringAt('$.querystring.downloads'),
        notifyByEmail: sfn.JsonPath.stringAt('$.querystring.notify'),
        requestContext: {
          requestId: sfn.JsonPath.stringAt('$.header.X-Amzn-Trace-Id'),
          traceId: sfn.JsonPath.stringAt('$.header.X-Amzn-Trace-Id'),
          domainName: sfn.JsonPath.stringAt('$.header.Host'),
        },
        responseContext: {
          statusCode: 200, //set default response, need to find a cleaner approach
        },
      }),
    });
    const isShareValid = new sfn.Choice(this, 'Is Share Valid?');
    const generateShareURLInvocation = new LambdaInvoke(this, 'Share URL', {
      lambdaFunction: generateShareURLFunction,
      outputPath: '$.Payload',
    });
    const recordShareInvocation = new LambdaInvoke(this, 'Record Share', {
      lambdaFunction: recordShareFunction,
      outputPath: '$.Payload',
    });
    const notifyShareInvocation = new LambdaInvoke(this, 'Notify Share', {
      lambdaFunction: recordShareFunction,
      outputPath: '$.Payload',
    });
    const endShareInvocation = new LambdaInvoke(this, 'Complete Share', {
      lambdaFunction: endShareFunction,
      outputPath: '$.Payload',
    });

    const shareChain = sfn.Chain.start(startShareInvocation).next(
      isShareValid
        .when(
          sfn.Condition.numberEquals('$.responseContext.statusCode', 200),
            generateShareURLInvocation.next(recordShareInvocation).next(notifyShareInvocation).next(endShareInvocation))
        .otherwise(endShareInvocation),
    );

    const shareStateMachine = new sfn.StateMachine(this, 'ShareStateMachine', {
      definition: shareChain,
      stateMachineType: sfn.StateMachineType.EXPRESS,
    });

    /*-------------------------------
     * Set up download step function
     -------------------------------*/
    const startDownloadInvocation = new LambdaInvoke(this, 'Validate Download', {
      lambdaFunction: startDownloadFunction,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        id: sfn.JsonPath.stringAt('$.header.X-Amzn-Trace-Id'),
        userId: sfn.JsonPath.stringAt('$.authorizer.principalId'),
        filepath: sfn.JsonPath.stringAt('$.path.filepath'),
        requestContext: {
          requestId: sfn.JsonPath.stringAt('$.header.X-Amzn-Trace-Id'),
          traceId: sfn.JsonPath.stringAt('$.header.X-Amzn-Trace-Id'),
          domainName: sfn.JsonPath.stringAt('$.header.Host'),
        },
        responseContext: {
          statusCode: 200, //set default response, need to find a cleaner approach
        },
      }),
    });
    const isDownloadValid = new sfn.Choice(this, 'Is Download Valid?');
    const eligibleDownloadURLInvocation = new LambdaInvoke(this, 'Check Eligibility', {
      lambdaFunction: eligibleDownloadFunction,
      outputPath: '$.Payload',
    });
    const isDownloadEligible = new sfn.Choice(this, 'Is Download Eligible?');
    const generateDownloadURLInvocation = new LambdaInvoke(this, 'Download URL', {
      lambdaFunction: generateDownloadURLFunction,
      outputPath: '$.Payload',
    });
    const recordDownloadInvocation = new LambdaInvoke(this, 'Record Download', {
      lambdaFunction: recordDownloadFunction,
      outputPath: '$.Payload',
    });
    const endDownloadInvocation = new LambdaInvoke(this, 'Complete Download', {
      lambdaFunction: endDownloadFunction,
      outputPath: '$.Payload',
    });

    const downloadChain = sfn.Chain.start(startDownloadInvocation).next(
      isDownloadValid
        .when(
          sfn.Condition.numberEquals('$.responseContext.statusCode', 200),
          eligibleDownloadURLInvocation.next(
            isDownloadEligible
              .when(
                sfn.Condition.numberEquals('$.responseContext.statusCode', 200),
                recordDownloadInvocation.next(generateDownloadURLInvocation).next(endDownloadInvocation),
              )
              .otherwise(endDownloadInvocation),
          ),
        )
        .otherwise(endDownloadInvocation),
    );

    const downloadStateMachine = new sfn.StateMachine(this, 'DownloadStateMachine', {
      definition: downloadChain,
      stateMachineType: sfn.StateMachineType.EXPRESS,
    });

    /*-------------------------------
     * Set up API Gateway routes
     -------------------------------*/

     // Define web integration response mapping templates
     const webIntegrationResponse : apigateway.IntegrationResponse[] = [
      {
        statusCode: '400',
        selectionPattern: '4\\d{2}',
        responseTemplates: {
          'application/json': '{"error": "Bad request!"}',
        },
       },
       {
        statusCode: '500',
        selectionPattern: '5\\d{2}',
        responseTemplates: {
          'application/json': '"error": $input.path(\'$.error\')',
        },
       },
       {
        statusCode: '200',
        selectionPattern: '2\\d{2}',
        responseTemplates: {
          'application/json':
            ' \
          #set($root = $util.parseJson($input.path(\'$.output\')))\
          #if($input.path(\'$.status\').toString().equals("FAILED"))\
          #set($context.responseOverride.status = 500)\
          {\
          "error": "$input.path(\'$.error\')",\
          "cause": "$input.path(\'$.cause\')"\
          }\
          #elseif($root.statusCode.toString().equals("302") || $root.statusCode.toString().equals("307"))\
          #set($context.responseOverride.status = $root.statusCode)\
          #set($context.responseOverride.header.content-type = "text/html")\
          #set($context.responseOverride.header.Set-Cookie = "$root.headers.Set-Cookie")\
          #set($context.responseOverride.header.Location = "$root.headers.Location")\
          #else\
          #set($context.responseOverride.status = $root.statusCode)\
          $input.path(\'$.output\')\
          #end',
        },
       }
     ];

     // Define the "/share/" route
     api.root
     .addResource('share')
     .addMethod(
       'GET',
       apigateway.StepFunctionsIntegration.startExecution(shareStateMachine, {
         headers: true,
         authorizer: true,
         passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
         integrationResponses: webIntegrationResponse
       }),
       {
         authorizationType: apigateway.AuthorizationType.CUSTOM,
         authorizer,
       },
     );

    // Define the "/download/{filepath+}" route
    api.root
      .addResource('download')
      .addResource('{filepath+}')
      .addMethod(
        'GET',
        apigateway.StepFunctionsIntegration.startExecution(downloadStateMachine, {
          headers: true,
          authorizer: true,
          passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
          integrationResponses: webIntegrationResponse
        }),
        {
          authorizationType: apigateway.AuthorizationType.CUSTOM,
          authorizer,
        },
      );

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

    const glueDbName = `${APPLICATION_NAME}-access-logs`;

    // Create a new Glue database for storing S3 access logs
    const glueDb = new glue.CfnDatabase(this, 'AccessLogsGlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: glueDbName,
        locationUri: `s3://${analyticsBucket.bucketName}`,
        description: 'Glue database to enable Athena queries',
      },
    });

    // Create a new Glue table for storing S3 access logs
    new glue.CfnTable(this, 'AccessLogsGlueTable', {
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

    // Create SQL query for downlaod report view
    const query = `
      SELECT
          request_datetime,
          REGEXP_EXTRACT(URL_DECODE(request_uri), 'x-amz-user-id=([^& ]+)', 1) as user_id,
          key as filepath,
          bytes_sent
      FROM
          access_logs
      WHERE
          operation = 'REST.GET.OBJECT'
          AND http_status = 200
      ORDER BY
          request_datetime
    `;

    // Helper function to create 'presto' JSON model
    const createPrestoView = (query: string): string => {
      return `/* Presto View: ${new Buffer(query).toString('base64')} */`;
    };

    // Presto JSON model (note: use varchar instead of string)
    const prestoObject = {
      originalSql: query,
      catalog: 'awsdatactalog',
      schema: glueDbName,
      columns: [
        { name: 'request_datetime', type: 'varchar' },
        { name: 'user_id', type: 'varchar' },
        { name: 'filepath', type: 'varchar' },
        { name: 'bytes_sent', type: 'bigint' },
      ],
      owner: this.account,
      runAsInvoker: false,
      properties: {},
    };

    // Create view as a Glue Table with table type = 'VIRTUAL VIEW'
    new glue.CfnTable(this, 'AccessLogsDownloadReportView', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseName: glueDb.ref,
      tableInput: {
        name: 'download_report',
        tableType: 'VIRTUAL_VIEW',
        viewExpandedText: '/* Presto View */',
        viewOriginalText: createPrestoView(JSON.stringify(prestoObject)),
        parameters: {
          presto_view: 'true',
          comment: 'Presto View',
        },
        partitionKeys: [],
        storageDescriptor: {
          columns: [
            { name: 'request_datetime', type: 'string' },
            { name: 'user_id', type: 'string' },
            { name: 'filepath', type: 'string' },
            { name: 'bytes_sent', type: 'bigint' },
          ],
          serdeInfo: {},
          location: '',
        },
      },
    });

    // Create Athena saved query
    new athena.CfnNamedQuery(this, 'AccessLogDownloadReportSavedQuery', {
      database: glueDbName,
      workGroup: 'primary',
      name: 'download_report',
      description: 'Download Report',
      queryString: query,
    });

    // Output variables
    new cdk.CfnOutput(this, 'DownloadIntegrationUri', {
      value: api.url,
      description: 'API URL',
    });
  }
}

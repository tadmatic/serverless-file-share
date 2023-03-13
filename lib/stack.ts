import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps, aws_lambda_nodejs } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

import * as packageJson from '../package.json';

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

    // Global lambda settings
    const functionSettings = {
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 256,
      environment: {
        AWS_ACCOUNT_ID: Stack.of(this).account,
        POWERTOOLS_SERVICE_NAME: packageJson.name,
        POWERTOOLS_LOGGER_LOG_LEVEL: 'WARN',
        POWERTOOLS_LOGGER_SAMPLE_RATE: '0.01',
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
        POWERTOOLS_METRICS_NAMESPACE: packageJson.name,
        BUCKET_NAME: bucket.bucketName,
        TABLE_NAME: table.tableName,
      },
      logRetention: logs.RetentionDays.THREE_MONTHS,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
      },
      awsSdkConnectionReuse: true,
      timeout: Duration.seconds(30),
    };

    // Create a Lambda function to handle download requests
    const downloadFunction = new aws_lambda_nodejs.NodejsFunction(this, 'MyFunction', {
      entry: './src/functions/downloadFunction.ts',
      ...functionSettings,
    });

    // Grant the Lambda function read access to the S3 bucket
    bucket.grantRead(downloadFunction);

    // Grant the Lambda function write access to the DynamoDB table
    table.grantWriteData(downloadFunction);

    // Create an API Gateway to expose the Lambda function
    const api = new apigateway.RestApi(this, 'DownloadAPI', {
      restApiName: 'Download API',
      description: 'API for downloading files from S3',
    });

    // Define the "/download/{filepath+}" route
    const downloadResource = api.root.addResource('download').addResource('{filepath+}');

    // Add lambda integration
    downloadResource.addMethod('GET', new apigateway.LambdaIntegration(downloadFunction));

    // Output variables
    new cdk.CfnOutput(this, 'DownloadIntegrationUri', {
      value: api.url,
      description: 'API URL',
    });
  }
}

import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk';

import { logger, metrics, tracer } from '../utilities/observability';

const s3 = AWSXRay.captureAWSClient(new AWS.S3());
const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';
const TABLE_NAME = process.env.TABLE_NAME ?? '';
const URL_EXPIRATION_SECONDS = 300; // 5 minutes

interface DownloadRequest {
  id: string;
  username: string;
  filePath: string;
  timestamp: string;
  presignedUrl: string;
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const username = event.requestContext.authorizer?.username;
  const filePath = event.pathParameters?.filepath;

  console.log('username');
  console.log(username);

  if (!filePath) {
    logger.error(`File path parameter is missing: ${event.resource}`);

    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'File path parameter is missing' }),
    };
  }

  // Generate a presigned URL for the file that is valid for one use
  const params = {
    Bucket: BUCKET_NAME,
    Key: filePath,
    Expires: URL_EXPIRATION_SECONDS,
  };
  const presignedUrl = s3.getSignedUrl('getObject', params);

  // Record the download request in DynamoDB
  const id = event.requestContext.requestId;
  const timestamp = new Date().toISOString();
  const downloadRequest: DownloadRequest = { id, username, filePath, timestamp, presignedUrl };
  const putParams = { TableName: TABLE_NAME, Item: downloadRequest };
  await dynamodb.put(putParams).promise();

  // Log download request metric to Cloudwatch
  metrics.addMetric('DownloadRequest', MetricUnits.Count, 1);

  // Perform a server-side redirect to the presigned URL
  return {
    statusCode: 307,
    headers: {
      Location: presignedUrl,
    },
    body: '',
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

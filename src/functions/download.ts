import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyResult } from 'aws-lambda';
import * as AWS from 'aws-sdk';

import { DownloadEvent, generateAuthUrl, getRedirectUri } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';
import { createPresignedUrl } from '../utilities/s3';

const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';
const TABLE_NAME = process.env.TABLE_NAME ?? '';

interface DownloadRequest {
  id: string;
  userId: string;
  filepath: string;
  timestamp: string;
}

const lambdaHandler = async (event: DownloadEvent): Promise<APIGatewayProxyResult> => {
  const { filepath, userId } = event;

  /*-------------------------------
   * STEP 1: Validate request
   * -----------------------------*/

  // Validate file path
  if (!filepath) {
    logger.error(`File path parameter is missing: ${event.filepath}`);

    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'File path parameter is missing' }),
    };
  }

  // If no valid user found, redirect to login page
  if (!userId || userId === '') {
    // Generate redirect callback url
    const redirectUri = getRedirectUri(event);

    // Generate auth request, pass filepath as state paramater in oAuth request
    const { authUrl, codeVerifier } = generateAuthUrl(redirectUri, filepath);

    // Store the PKCE code verifier in a cookie and redirect to auth url
    return {
      statusCode: 302,
      body: '',
      headers: {
        'Set-Cookie': `code_verifier=${codeVerifier}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        Location: authUrl,
      },
    };
  }

  /*-------------------------------
   * STEP 2: Check if user is allowed to download (e.g. check download quota from dynamodb)
   * -----------------------------*/

  // TODO

  /*-------------------------------
   * STEP 3: Record download
   * -----------------------------*/

  // Record the download request in DynamoDB
  const item: DownloadRequest = {
    id: event.requestContext.requestId,
    userId,
    filepath,
    timestamp: new Date().toISOString(),
  };

  const putParams = {
    TableName: TABLE_NAME,
    Item: item,
  };

  await dynamodb.put(putParams).promise();

  // Log download request metric to Cloudwatch
  metrics.addMetric('DownloadRequest', MetricUnits.Count, 1);

  /*-------------------------------
   * STEP 4: Generate presigned url
   * -----------------------------*/

  const presignedUrl = await createPresignedUrl({
    bucket: BUCKET_NAME,
    key: filepath,
    userId,
  });

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

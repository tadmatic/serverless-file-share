import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk';

import { generateAuthUrl, getCookieFromString, getRedirectUriByHost, getUserDetailsViaAccessToken } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const s3 = AWSXRay.captureAWSClient(new AWS.S3());
const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';
const TABLE_NAME = process.env.TABLE_NAME ?? '';
const URL_EXPIRATION_SECONDS = 30; // 30 seconds

interface DownloadEvent {
  id: string;
  username: string;
  filepath: string;
  timestamp: string;
  presignedUrl: string;
  cookie: string;
  host: string;
}

const lambdaHandler = async (event: DownloadEvent): Promise<APIGatewayProxyResult> => {

  // Validate file path
  if (!event.filepath) {
    logger.error(`File path parameter is missing: ${event.filepath}`);

    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'File path parameter is missing' })
    };
  }

  // Check if cognito JWT access token is present
  const token = getCookieFromString(event?.cookie, 'access_token');
  
  // Validate access token
  const user = token ? await getUserDetailsViaAccessToken(token) : undefined;


  if (!user) {
    // Generate redirect callback url
    const redirectUri = getRedirectUriByHost(event.host);

    // Generate auth request, pass filepath as state paramater in oAuth request
    const { authUrl, codeVerifier } = generateAuthUrl(redirectUri, event.filepath);

    // Store the PKCE code verifier in a cookie and redirect to auth url
    return {
      statusCode: 302,
      body: '',
      headers: {
        'Set-Cookie': `code_verifier=${codeVerifier}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        Location: authUrl
      },
    };
  }
  
  // Generate a presigned URL for the file that is valid for one use
  const params = {
    Bucket: BUCKET_NAME,
    Key: event.filepath,
    Expires: URL_EXPIRATION_SECONDS,
  };
  event.presignedUrl = s3.getSignedUrl('getObject', params);

  // Record the download request in DynamoDB
  //const id = event.id; // request id is empty
  event.timestamp = new Date().toISOString();
  event.username = user.Username;
  const putParams = { TableName: TABLE_NAME, Item: event };
  await dynamodb.put(putParams).promise();

  // Log download request metric to Cloudwatch
  metrics.addMetric('DownloadRequest', MetricUnits.Count, 1);
 
  // Perform a server-side redirect to the presigned URL

  return {
    statusCode: 307,
    headers: {
      Location: event.presignedUrl
    },
    body: '',
 };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;
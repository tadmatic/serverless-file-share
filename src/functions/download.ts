import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as AWS from 'aws-sdk';
// import * as AWSXRay from 'aws-xray-sdk';

import { generateAuthUrl, getCookie, getRedirectUri, getUserDetailsViaAccessToken } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const s3 = new S3Client({}); // AWSXRay.captureAWSClient();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';
const TABLE_NAME = process.env.TABLE_NAME ?? '';
const URL_EXPIRATION_SECONDS = 30; // 30 seconds

interface DownloadRequest {
  id: string;
  username: string;
  filepath: string;
  timestamp: string;
  presignedUrl: string;
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const username = event.requestContext.authorizer?.username;
  const filepath = event.pathParameters?.filepath;

  // Validate file path
  if (!filepath) {
    logger.error(`File path parameter is missing: ${event.resource}`);

    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'File path parameter is missing' }),
    };
  }

  // Check if cognito JWT access token is present
  const token = getCookie(event, 'access_token');

  // Validate access token
  const user = token ? await getUserDetailsViaAccessToken(token) : undefined;

  // If no valid user found, redirect to login page
  if (!user) {
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

  const email = user.UserAttributes.find((x) => x.Name === 'email')?.Value;

  const params = {
    Bucket: BUCKET_NAME,
    Key: filepath,
    Expires: URL_EXPIRATION_SECONDS,
    Metadata: {
      email,
    },
  };
  const command = new GetObjectCommand(params);
  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  // Record the download request in DynamoDB
  const id = event.requestContext.requestId;
  const timestamp = new Date().toISOString();
  const downloadRequest: DownloadRequest = { id, username, filepath, timestamp, presignedUrl };
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

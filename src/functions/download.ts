import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import { fromEnv } from '@aws-sdk/credential-providers';
import { Hash } from '@aws-sdk/hash-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';
import { parseUrl } from '@aws-sdk/url-parser';
import { formatUrl } from '@aws-sdk/util-format-url';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as AWS from 'aws-sdk';

import { generateAuthUrl, getCookie, getRedirectUri, getUserDetailsViaAccessToken } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';
const TABLE_NAME = process.env.TABLE_NAME ?? '';

interface DownloadRequest {
  id: string;
  username: string;
  filepath: string;
  timestamp: string;
  presignedUrl: string;
}

interface SignedUrlRequest {
  bucket: string;
  key: string;
  email: string | undefined;
}

const createPresignedUrl = async ({ bucket, key, email }: SignedUrlRequest) => {
  const url = parseUrl(`https://${bucket}.s3.${process.env.REGION}.amazonaws.com/${key}`);

  // add custom meta data
  if (email) {
    url.query = {
      'x-amz-email': email,
    };
  }

  const presigner = new S3RequestPresigner({
    credentials: fromEnv(),
    region: process.env.REGION ?? '',
    sha256: Hash.bind(null, 'sha256'),
  });

  const signedUrlObject = await presigner.presign(new HttpRequest(url));
  return formatUrl(signedUrlObject);
};

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

  const presignedUrl = await createPresignedUrl({
    bucket: BUCKET_NAME,
    key: filepath,
    email,
  });

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

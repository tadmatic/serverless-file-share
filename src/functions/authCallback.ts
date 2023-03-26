import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { exchangeToken, getCookie, getRedirectUri } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const code = event.queryStringParameters?.code;

  // Use current domain to generate redirect_uri
  const redirectUri = getRedirectUri(event);

  // Get PKCE verifier from cookie
  const codeVerifier = getCookie(event, 'code_verifier');

  if (!code || !codeVerifier) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Missing params', code, codeVerifier }),
    };
  }

  const result = await exchangeToken(code, codeVerifier, redirectUri);

  // Save access_token in cookie and clear PKCE code_verifier cookie
  return {
    statusCode: 200,
    body: JSON.stringify(result),
    multiValueHeaders: {
      'Set-Cookie': [
        `access_token=${result.access_token}; Secure; HttpOnly; SameSite=Strict`,
        'code_verifier=; Secure; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ],
    },
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

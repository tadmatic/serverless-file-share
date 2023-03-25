import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { exchangeToken, getCookie, getRedirectUri } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const code = event.queryStringParameters?.code;

  // use current URL
  const redirectUri = getRedirectUri(event);
  const codeVerifier = getCookie(event, 'code_verifier');

  if (!code || !codeVerifier) {
    throw new Error('Auth params missing');
  }

  const result = await exchangeToken(code, codeVerifier, redirectUri);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
    headers: {
      'Set-Cookie': `access_token=${result.access_token}; Secure; HttpOnly; SameSite=Strict`,
    },
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

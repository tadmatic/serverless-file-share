import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { generateAuthUrl, getRedirectUri } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const redirectUri = getRedirectUri(event);

  const { authUrl, codeVerifier } = generateAuthUrl(redirectUri);

  // Store the PKCE code verifier in a cookie and redirect to auth url
  const response = {
    statusCode: 302,
    body: '',
    headers: {
      'Set-Cookie': `code_verifier=${codeVerifier}; Secure; HttpOnly; SameSite=Lax`,
      Location: authUrl,
    },
  };

  return response;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

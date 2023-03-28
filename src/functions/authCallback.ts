import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { exchangeToken, getCookie, getRedirectUri } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const code = event.queryStringParameters?.code;
  const filepath = event.queryStringParameters?.state;

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

  // if filepath was passed back in state param, redirect to filepath
  if (filepath) {
    // Save access_token in cookie and clear PKCE code_verifier cookie
    return {
      statusCode: 302,
      body: '',
      headers: {
        Location: `/prod/download/${filepath}`,
      },
      multiValueHeaders: {
        'Set-Cookie': [
          `access_token=${result.access_token}; Path=/; Secure; HttpOnly; SameSite=Lax`,
          'code_verifier=; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        ],
      },
    };
  }

  // Save access_token in cookie and clear PKCE code_verifier cookie
  return {
    statusCode: 200,
    // print out cognito response
    body: JSON.stringify(result),
    multiValueHeaders: {
      'Set-Cookie': [
        `access_token=${result.access_token}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        'code_verifier=; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ],
    },
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

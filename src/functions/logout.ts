import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { CLIENT_ID, COGNITO_LOGOUT_URL, getLogoutUri } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const logoutCallbackUri = getLogoutUri(event);
  const logoutUrl = `${COGNITO_LOGOUT_URL}?client_id=${CLIENT_ID}&logout_uri=${logoutCallbackUri}`;

  // Clear cookies and redirect to cognito logout url
  return {
    statusCode: 302,
    headers: {
      Location: logoutUrl,
    },
    multiValueHeaders: {
      'Set-Cookie': [
        `access_token=; Secure; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        'code_verifier=; Secure; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ],
    },
    body: '',
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityServiceProvider } from 'aws-sdk';

import { getCookie } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const cognito = new CognitoIdentityServiceProvider();

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const token = getCookie(event, 'access_token');

  console.log('token');
  console.log(token);

  if (token) {
    // Revoke the user's session
    await cognito
      .globalSignOut({
        AccessToken: token,
      })
      .promise();
  }

  // Return a response that clears the access_token cookie
  const response = {
    statusCode: 200,
    headers: {
      'Set-Cookie': 'access_token=; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    },
    body: 'You have been logged out.',
  };

  return response;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

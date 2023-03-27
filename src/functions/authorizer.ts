import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

import { getCookie, getUserDetailsViaAccessToken } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const token = getCookie(event, 'access_token');

  if (token) {
    const user = await getUserDetailsViaAccessToken(token);

    if (user) {
      // return authorizer success response
      return {
        principalId: user.Username,
        policyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'execute-api:Invoke',
              Effect: 'Allow',
              Resource: event.methodArn,
            },
          ],
        },
        context: {
          username: user.Username,
        },
      };
    }
  }

  // otherwise, return authorizer deny response
  return {
    principalId: '',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'deny',
          Effect: 'deny',
          Resource: event.methodArn,
        },
      ],
    },
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

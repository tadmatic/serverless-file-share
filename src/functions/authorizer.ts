import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoIdentityServiceProvider } from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk';

import { getCookie } from '../utilities/auth';
import { logger, metrics, tracer } from '../utilities/observability';

const cognito = AWSXRay.captureAWSClient(new CognitoIdentityServiceProvider());

const validateAccessToken = async (token: string): Promise<string | undefined> => {
  try {
    const result = await cognito.getUser({ AccessToken: token }).promise();
    return result.Username;
  } catch (err) {
    logger.error(`Error validating access token: ${err}`);
    return undefined;
  }
};

const lambdaHandler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const token = getCookie(event, 'access_token');
  console.log('token');
  console.log(token);

  if (token) {
    const username = await validateAccessToken(token);
    console.log('username');
    console.log(username);

    if (username) {
      // return authorizer success response
      return {
        principalId: username,
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
          username: username,
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

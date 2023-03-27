import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyResult } from 'aws-lambda';

import { logger, metrics, tracer } from '../utilities/observability';

const lambdaHandler = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    body: 'You have been logged out.',
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

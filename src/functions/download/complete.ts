import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyResult } from 'aws-lambda';

import { DownloadEvent } from '../../utilities/types';
import { logger, metrics, tracer } from '../../utilities/observability';

const lambdaHandler = async (event: DownloadEvent): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: event.responseContext.statusCode,
    headers: event.responseContext.headers,
    body: event.responseContext.body ?? '',
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

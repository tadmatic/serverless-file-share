import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { ShareEvent } from './types';
import { logger, metrics, tracer } from '../../utilities/observability';

const lambdaHandler = async (event: ShareEvent): Promise<ShareEvent> => {
  // const { filepath, userId } = event;

  // Check if user is allowed to download (e.g. check download quota from dynamodb)

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

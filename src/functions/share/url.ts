import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { ShareEvent } from './types';
import { logger, metrics, tracer } from '../../utilities/observability';
import { getApiUri } from '../../utilities/auth';

const lambdaHandler = async (event: ShareEvent): Promise<ShareEvent> => {
  // parse external url
  const path = new URL(event.externalUrl).pathname;
  
  // generate share url
  event.shareUrl = new URL(getApiUri(event, `/download${path}`));

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

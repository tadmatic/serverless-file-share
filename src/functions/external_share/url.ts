import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { getApiUri } from '../../utilities/auth';
import { logger, metrics, tracer } from '../../utilities/observability';
import { ExternalShareEvent } from '../../utilities/types';

const lambdaHandler = async (event: ExternalShareEvent): Promise<ExternalShareEvent> => {
  // parse external url
  const pathname = new URL(event.presignedUrl).pathname;
  event.filepath = pathname.substring(1, pathname.length);

  // generate share url
  event.shareUrl = new URL(getApiUri(event, `/download/${event.filepath}`));

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

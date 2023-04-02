import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { logger, metrics, tracer } from '../../utilities/observability';
import { ExternalShareEvent } from '../../utilities/types';

const lambdaHandler = async (event: ExternalShareEvent): Promise<ExternalShareEvent> => {
  //TODO check if user selected a notification and send email

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

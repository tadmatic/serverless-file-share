import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { logger, metrics, tracer } from '../utilities/observability';

export class SampleClass {
  // Example of tracing function calls using x-ray @tracer decorator
  @tracer.captureMethod()
  someFunction(): void {
    logger.info('someFunction called');
  }
}

const lambdaHandler = async () => {
  // Example of logging messages
  logger.info('Cron task started');

  new SampleClass().someFunction();

  // Example of adding metrics (via logs)
  metrics.addMetric('RunCount', MetricUnits.Count, 1);
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

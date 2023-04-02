import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { DownloadEvent } from './types';
import { recordDownload } from '../../utilities/dynamodb';
import { logger, metrics, tracer } from '../../utilities/observability';

const lambdaHandler = async (event: DownloadEvent): Promise<DownloadEvent> => {
  const { filepath, userId } = event;

  // Record the download request in DynamoDB
  await recordDownload({ filepath, userId });

  // Log download request metric to Cloudwatch
  metrics.addMetric('DownloadRequest', MetricUnits.Count, 1);

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

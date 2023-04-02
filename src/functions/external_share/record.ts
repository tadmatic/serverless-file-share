import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { recordShareFileRequest } from '../../utilities/dynamodb';
import { logger, metrics, tracer } from '../../utilities/observability';
import { ExternalShareEvent } from '../../utilities/types';

const lambdaHandler = async (event: ExternalShareEvent): Promise<ExternalShareEvent> => {
  const { filepath, userId, shareUserId, maxNumberOfDownloads, presignedUrl } = event;

  // Record the download request in DynamoDB
  await recordShareFileRequest({
    filepath,
    ownerUserId: userId,
    shareUserId,
    maxNumberOfDownloads: maxNumberOfDownloads.toString(),
    type: 'external',
    presignedUrl,
  });

  // Log download request metric to Cloudwatch
  metrics.addMetric('DownloadRequest', MetricUnits.Count, 1);

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

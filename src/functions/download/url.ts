import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { getShareRecord } from '../../utilities/dynamodb';
import { logger, metrics, tracer } from '../../utilities/observability';
import { createPresignedUrl } from '../../utilities/s3';
import { DownloadEvent } from '../../utilities/types';

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';

const lambdaHandler = async (event: DownloadEvent): Promise<DownloadEvent> => {
  const { filepath, userId } = event;
  const shareRecord = await getShareRecord({ filepath, userId });

  // TODO model map share record
  event.presignedUrl =
    shareRecord && shareRecord.type && (shareRecord.type as string) === 'external'
      ? (shareRecord.presignedUrl as string)
      : (await createPresignedUrl({ bucket: BUCKET_NAME, key: event.filepath, userId: event.userId })).toString();

  // Perform a server-side redirect to the presigned URL
  event.responseContext = {
    statusCode: 307,
    headers: {
      Location: event.presignedUrl,
      'X-Amzn-Trace-Id': event.requestContext.traceId,
    },
    body: '',
  };

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

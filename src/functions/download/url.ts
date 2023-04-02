import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { DownloadEvent } from '../../utilities/types';
import { logger, metrics, tracer } from '../../utilities/observability';
import { createPresignedUrl } from '../../utilities/s3';

const BUCKET_NAME = process.env.BUCKET_NAME ?? '';

const lambdaHandler = async (event: DownloadEvent): Promise<DownloadEvent> => {
  const presignedUrl = await createPresignedUrl({
    bucket: BUCKET_NAME,
    key: event.filepath,
    userId: event.userId,
  });

  // Perform a server-side redirect to the presigned URL
  event.responseContext = {
    statusCode: 307,
    headers: {
      Location: presignedUrl,
      "X-Amzn-Trace-Id" : event.requestContext.traceId
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

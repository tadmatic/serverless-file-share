import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { S3Event } from 'aws-lambda';

import { recordFileOwner } from '../utilities/dynamodb';
import { logger, metrics, tracer } from '../utilities/observability';
import { getObjectMetaData } from '../utilities/s3';

const lambdaHandler = async (event: S3Event) => {
  // TODO: handle multiple records
  const record = event.Records[0].s3;
  const bucket = record.bucket.name;
  const key = record.object.key;

  // Get meta data from S3
  const data = await getObjectMetaData({ bucket, key });

  // Extract user id
  const userId = data.Metadata ? data.Metadata['user-id'] : undefined;

  if (userId) {
    await recordFileOwner({ filepath: key, userId });
  }
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

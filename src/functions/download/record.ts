import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { MetricUnits, logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import * as AWS from 'aws-sdk';

import { DownloadEvent } from './types';
import { logger, metrics, tracer } from '../../utilities/observability';
import { recordDownload } from '../../utilities/dynamodb';

const dynamodb = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME ?? '';

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

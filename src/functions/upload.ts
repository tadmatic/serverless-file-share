import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { logger, metrics, tracer } from '../utilities/observability';
import { createPresignedUrl } from '../utilities/s3';

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Get file path from URL path param
  const filepath = event.pathParameters?.filepath;

  // Custom authorizer authenticates user and sets userId context
  const userId = event.requestContext.authorizer?.userId;

  if (!userId) {
    return {
      statusCode: 401,
      body: 'Unauthorized',
    };
  }

  if (!filepath) {
    logger.error(`File path parameter is missing`);

    return {
      statusCode: 400,
      body: 'File path parameter is missing',
    };
  }

  // Create presigned url for upload
  const presignedUrl = await createPresignedUrl({
    bucket: process.env.BUCKET_NAME ?? '',
    key: filepath,
    userId,
    method: 'PUT',
  });

  return {
    statusCode: 200,
    body: presignedUrl,
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

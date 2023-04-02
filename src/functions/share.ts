import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { recordShareFileRequest } from '../utilities/dynamodb';
import { logger, metrics, tracer } from '../utilities/observability';

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

  // This function assumes file is already uploaded - use /upload endpoint to upload prior to /share
  if (!filepath) {
    logger.error(`File path parameter is missing`);

    return {
      statusCode: 400,
      body: 'File path parameter is missing',
    };
  }

  const body = JSON.parse(event.body || '{}');
  const { userId: shareUserId, maxNumberOfDownloads, sendEmail } = body;

  // Record share in dynamodb
  await recordShareFileRequest({
    ownerUserId: userId,
    filepath,
    shareUserId,
    maxNumberOfDownloads,
  });

  if (sendEmail) {
    // TODO: send email
  }

  return {
    statusCode: 200,
    body: 'OK',
  };
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

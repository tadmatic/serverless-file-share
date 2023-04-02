import { injectLambdaContext } from '@aws-lambda-powertools/logger';
import { logMetrics } from '@aws-lambda-powertools/metrics';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';

import { DownloadEvent } from '../../utilities/types';
import { generateAuthUrl, getRedirectUri } from '../../utilities/auth';
import { logger, metrics, tracer } from '../../utilities/observability';

const lambdaHandler = async (event: DownloadEvent): Promise<DownloadEvent> => {
  const { filepath, userId } = event;

  // validate file path
  if (!filepath) {
    logger.error(`File path parameter is missing: ${event.filepath}`);

    event.responseContext = {
      statusCode: 400,
      body: JSON.stringify({ message: 'File path parameter is missing' }),
      headers: {
        "X-Amzn-Trace-Id": event.requestContext.traceId
      },
    };
  }

  // If no valid user found, redirect to login page
  if (!userId || userId === '') {
    // Generate redirect callback url
    const redirectUri = getRedirectUri(event);

    // Generate auth request, pass filepath as state paramater in oAuth request
    const { authUrl, codeVerifier } = generateAuthUrl(redirectUri, filepath);

    // Store the PKCE code verifier in a cookie and redirect to auth url
    event.responseContext = {
      statusCode: 302,
      body: JSON.stringify({ message: 'File path parameter is missing' }),
      headers: {
        'Set-Cookie': `code_verifier=${codeVerifier}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        Location: authUrl,
        "X-Amzn-Trace-Id": event.requestContext.traceId
      },
    };
  }

  return event;
};

export const handler = middy(lambdaHandler)
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(injectLambdaContext(logger, { clearState: true }));

export default handler;

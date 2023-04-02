export interface ShareEvent {
  id: string;
  userId: string;
  timestamp: string;
  url: string;
  email: string;
  downloads: string;
  notify: string;
  requestContext: {
    requestId: string;
    traceId: string;
    domainName: string;
  };
  responseContext: {
    statusCode: number;
    body?: string;
    headers?: {
      'Set-Cookie'?: string;
      Location?: string;
      "X-Amzn-Trace-Id"?: string;
    };
  };
}

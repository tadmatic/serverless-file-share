export interface ShareEvent {
  id: string;
  userId: string;
  timestamp: string;
  
  externalUrl:string;
  emailAddress: string;
  maxNumberOfDownloads: number;
  notifyByEmail:boolean;
  
  shareUrl : URL;
  
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

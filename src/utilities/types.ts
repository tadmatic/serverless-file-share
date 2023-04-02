interface BaseFileShareEvent {
  id: string;
  userId: string;
  timestamp: string;
  filepath: string;
  presignedUrl: string;
  
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

export interface FileShareEvent extends BaseFileShareEvent{

}

interface BaseShareEvent extends FileShareEvent{
  shareUserId: string;
  maxNumberOfDownloads: number;
  notifyByEmail:boolean;
  type : 'internal' | 'external';
}

export interface ExternalShareEvent extends BaseShareEvent{
  shareUrl : URL; 
  type : 'external';
}

export interface DownloadEvent extends BaseFileShareEvent {

}
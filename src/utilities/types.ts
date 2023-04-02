export interface BaseFileShareEvent {
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
      'X-Amzn-Trace-Id'?: string;
    };
  };
}

export interface BaseShareEvent extends BaseFileShareEvent {
  shareUserId: string;
  maxNumberOfDownloads: number;
  notifyByEmail: boolean;
  type: 'internal' | 'external';
}

export interface ExternalShareEvent extends BaseShareEvent {
  shareUrl: URL;
  type: 'external';
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DownloadEvent extends BaseFileShareEvent {}

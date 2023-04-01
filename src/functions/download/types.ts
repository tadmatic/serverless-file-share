export interface IDownloadResponse{
    statusCode: number;
    body?: string;
    headers?: {
      'Set-Cookie'?: string;
      Location: string;
    }
}

export interface IDownload {
    id: string;
    userId: string;
    filepath: string;
    timestamp: string;
    presignedUrl: string;
    requestContext: {
      requestId: string;
      domainName: string;
    };  
    responseContext: IDownloadResponse;
}
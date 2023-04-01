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
    responseContext: { 
      statusCode: number;
      body?: string;
      headers?: {
        'Set-Cookie'?: string;
        Location: string;
      }
    }
}
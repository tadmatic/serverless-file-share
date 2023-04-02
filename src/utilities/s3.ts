import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { fromEnv } from '@aws-sdk/credential-providers';
import { Hash } from '@aws-sdk/hash-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';
import { parseUrl } from '@aws-sdk/url-parser';
import { formatUrl } from '@aws-sdk/util-format-url';

const s3 = new S3Client({ region: process.env.REGION });

interface SignedUrlRequest {
  bucket: string;
  key: string;
  userId: string | undefined;
  method?: 'GET' | 'PUT';
}

interface GetObjectMetadataRequest {
  bucket: string;
  key: string;
}

export const createPresignedUrl = async ({ bucket, key, userId, method = 'GET' }: SignedUrlRequest) => {
  const url = parseUrl(`https://${bucket}.s3.${process.env.REGION}.amazonaws.com/${key}`);

  // add custom meta data
  if (userId) {
    url.query = {
      'x-amz-meta-user-id': userId,
    };
  }

  const presigner = new S3RequestPresigner({
    credentials: fromEnv(),
    region: process.env.REGION ?? '',
    sha256: Hash.bind(null, 'sha256'),
  });

  const signedUrlObject = await presigner.presign(new HttpRequest({ ...url, method }));
  return formatUrl(signedUrlObject);
};

export const getObjectMetaData = async ({ bucket, key }: GetObjectMetadataRequest) => {
  const params = {
    Bucket: bucket,
    Key: key,
  };
  const command = new HeadObjectCommand(params);
  const response = await s3.send(command);
  return response;
};

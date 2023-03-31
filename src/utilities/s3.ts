import { fromEnv } from '@aws-sdk/credential-providers';
import { Hash } from '@aws-sdk/hash-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';
import { parseUrl } from '@aws-sdk/url-parser';
import { formatUrl } from '@aws-sdk/util-format-url';

interface SignedUrlRequest {
  bucket: string;
  key: string;
  userId: string | undefined;
}

export const createPresignedUrl = async ({ bucket, key, userId }: SignedUrlRequest) => {
  const url = parseUrl(`https://${bucket}.s3.${process.env.REGION}.amazonaws.com/${key}`);

  // add custom meta data
  if (userId) {
    url.query = {
      'x-amz-user-id': userId,
    };
  }

  const presigner = new S3RequestPresigner({
    credentials: fromEnv(),
    region: process.env.REGION ?? '',
    sha256: Hash.bind(null, 'sha256'),
  });

  const signedUrlObject = await presigner.presign(new HttpRequest(url));
  return formatUrl(signedUrlObject);
};

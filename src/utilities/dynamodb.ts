import * as AWS from 'aws-sdk';

const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME ?? '';

export const RECORD_TYPE_OWNER_PREFIX = 'OWNER';
export const RECORD_TYPE_SHARE_PREFIX = 'SHARE';
export const RECORD_TYPE_DOWNLOAD_PREFIX = 'DOWNLOAD';

interface RecordDownloadRequest {
  filepath: string;
  userId: string;
}

interface ShareFileRequest {
  filepath: string;
  ownerUserId: string;
  shareUserId: string;
  maxNumberOfDownloads: string;
  type?: 'internal' | 'external';
  presignedUrl: string;
}

interface CreateFileRequest {
  filepath: string;
  userId: string;
}

// Record when a particular user downloads a file
export const recordDownload = async ({ filepath, userId }: RecordDownloadRequest) => {
  // get current date
  const timestamp = new Date().toISOString();

  const item = {
    filepath,
    record: `${userId}#${RECORD_TYPE_DOWNLOAD_PREFIX}#${timestamp}`,
    userId,
    timestamp,
  };

  const putParams = {
    TableName: TABLE_NAME,
    Item: item,
  };

  await dynamodb.put(putParams).promise();
};

// Record a record when sharing a user shares file with another user
export const recordShareFileRequest = async ({
  filepath,
  ownerUserId,
  shareUserId,
  maxNumberOfDownloads,
  type = 'internal',
  presignedUrl,
}: ShareFileRequest) => {
  // get current date
  const timestamp = new Date().toISOString();

  const item = {
    filepath,
    record: `${shareUserId}#${RECORD_TYPE_SHARE_PREFIX}`,
    ownerUserId,
    shareUserId,
    maxNumberOfDownloads,
    timestamp,
    type,
    presignedUrl,
  };

  const putParams = {
    TableName: TABLE_NAME,
    Item: item,
  };

  await dynamodb.put(putParams).promise();
};

// Create a record when a new file is uploaded by a user
export const recordFileOwner = async ({ filepath, userId }: CreateFileRequest) => {
  // get current date
  const timestamp = new Date().toISOString();

  const item = {
    filepath,
    record: `${userId}#${RECORD_TYPE_OWNER_PREFIX}`,
    userId,
    timestamp,
  };

  const putParams = {
    TableName: TABLE_NAME,
    Item: item,
  };

  await dynamodb.put(putParams).promise();
};

// Check if a user is allowed to download a file
export const isAllowedToDownload = async ({ filepath, userId }: CreateFileRequest) => {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: '#pk = :filepath and begins_with(#sk, :userId)',
    ExpressionAttributeNames: {
      '#pk': 'filepath',
      '#sk': 'record',
    },
    ExpressionAttributeValues: {
      ':filepath': filepath,
      ':userId': `${userId}#`,
    },
  };

  const result = await dynamodb.query(params).promise();

  if (result.Count === 0) {
    return false;
  }

  // TODO move to service/repo application architecture pattern
  const ownerRecord = result.Items?.find((r) => r.record === `${userId}#${RECORD_TYPE_OWNER_PREFIX}`);
  const shareRecord = result.Items?.find((r) => r.record === `${userId}#${RECORD_TYPE_SHARE_PREFIX}`);
  const downloadRecords = result.Items?.filter((r) => r.record === `${userId}#${RECORD_TYPE_DOWNLOAD_PREFIX}`) ?? [];

  if (ownerRecord) {
    // user is the owner of the file
    return true;
  }

  if (!shareRecord) {
    return false;
  }

  // If share record exists, check download quota
  return downloadRecords?.length < shareRecord.maxNumberOfDownloads;
};

// retrieve share request record
export const getShareExternalUrl = async ({ filepath, userId }: CreateFileRequest): Promise<string | undefined> => {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: '#pk = :filepath and begins_with(#sk, :userId)',
    ExpressionAttributeNames: {
      '#pk': 'filepath',
      '#sk': 'record',
    },
    ExpressionAttributeValues: {
      ':filepath': filepath,
      ':userId': `${userId}#`,
    },
  };

  const result = await dynamodb.query(params).promise();

  if (result.Count === 0) {
    return undefined;
  }

  // TODO move to service/repo application architecture pattern
  const record = `${userId}#${RECORD_TYPE_SHARE_PREFIX}`;

  const item = result.Items?.find((r) => r.record === record);

  if (item && item.type === 'external') {
    console.log(item.presignedUrl);
    return item.presignedUrl;
  }

  return undefined;
};

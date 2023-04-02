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
export const shareFile = async ({ filepath, ownerUserId, shareUserId, maxNumberOfDownloads }: ShareFileRequest) => {
  // get current date
  const timestamp = new Date().toISOString();

  const item = {
    filepath,
    record: `${shareUserId}#${RECORD_TYPE_SHARE_PREFIX}`,
    ownerUserId,
    shareUserId,
    maxNumberOfDownloads,
    timestamp,
  };

  const putParams = {
    TableName: TABLE_NAME,
    Item: item,
  };

  await dynamodb.put(putParams).promise();
};

// Create a record when a new file is uploaded by a user
export const createFile = async ({ filepath, userId }: CreateFileRequest) => {
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
  const downloadRecords = result.Items?.filter((r) => r.record === `${userId}#${RECORD_TYPE_SHARE_PREFIX}`) ?? [];

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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = 'one-time-tokens';
const TTL_SECONDS = 180;

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.requestContext?.http?.path;

  if (method === 'POST' && path === '/create') {
    const body = JSON.parse(event.body || '{}');
    if (!body.redirectUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'redirectUrl is required' }) };
    }

    const token = randomUUID();
    const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;

    await client.send(new PutCommand({
      TableName: TABLE,
      Item: { token, url: body.redirectUrl, ttl, used: false },
    }));

    const link = `https://${event.requestContext.domainName}/r/${token}`;
    return {
      statusCode: 200,
      body: JSON.stringify({ link, expiresInSeconds: TTL_SECONDS }),
    };
  }

  const match = path?.match(/^\/r\/([^/]+)$/);

  if (method === 'GET' && match) {
    const token = match[1];
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await client.send(new UpdateCommand({
        TableName: TABLE,
        Key: { token },
        UpdateExpression: 'SET used = :t',
        ConditionExpression: 'used = :f AND #ttl > :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':t': true, ':f': false, ':now': now },
        ReturnValues: 'ALL_NEW',
      }));

      return {
        statusCode: 302,
        headers: { Location: result.Attributes.url },
        body: '',
      };
    } catch (e) {
      return {
        statusCode: 410,
        body: 'このリンクは無効または使用済みです。',
      };
    }
  }

  return { statusCode: 404, body: 'Not Found' };
};

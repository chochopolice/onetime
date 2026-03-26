import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = 'one-time-tokens';
const TTL_SECONDS = 180;
const REDIRECT_URL = 'https://chochopolice.github.io/stock/';

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.requestContext?.http?.path;

  // POST /create : トークン発行
  if (method === 'POST' && path === '/create') {
    const token = randomUUID();
    const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;

    await client.send(new PutCommand({
      TableName: TABLE,
      Item: { token, url: REDIRECT_URL, ttl, used: false },
    }));

    const link = `https://${event.requestContext.domainName}/r/${token}`;
    return {
      statusCode: 200,
      body: JSON.stringify({ link, expiresInSeconds: TTL_SECONDS }),
    };
  }

  // GET /r/:token : ワンタイム表示（URLを隠したままコンテンツを返す）
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

      const targetUrl = result.Attributes.url;

      // リダイレクトせずHTMLを返す（アドレスバーのURLは変わらない）
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>読み込み中...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe src="${targetUrl}" allowfullscreen></iframe>
</body>
</html>`,
      };
    } catch (e) {
      return {
        statusCode: 410,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>無効なリンク</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f5f5f5; }
    .box { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    h1 { color: #e53e3e; margin-bottom: 12px; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="box">
    <h1>リンクが無効です</h1>
    <p>このリンクはすでに使用済みか、有効期限が切れています。</p>
  </div>
</body>
</html>`,
      };
    }
  }

  return { statusCode: 404, body: 'Not Found' };
};

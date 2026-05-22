import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfig } from '../config.js';

let s3: S3Client | null = null;

function getClient(): S3Client {
  if (!s3) {
    const cfg = getConfig();
    s3 = new S3Client({
      endpoint: cfg.MINIO_ENDPOINT,
      region: 'us-east-1',
      credentials: {
        accessKeyId: cfg.MINIO_ACCESS_KEY,
        secretAccessKey: cfg.MINIO_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3;
}

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function isAllowedMimetype(mimetype: string): boolean {
  return mimetype in ALLOWED_TYPES;
}

export async function uploadAsset(
  buffer: Buffer,
  originalName: string,
  mimetype: string,
  tenantId: string,
): Promise<string> {
  const cfg = getConfig();
  const ext = ALLOWED_TYPES[mimetype] ?? extname(originalName) ?? '.bin';
  const key = `${tenantId}/follow-ups/${randomUUID()}${ext}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: cfg.MINIO_BUCKET_ASSETS,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    }),
  );

  return `${cfg.MINIO_PUBLIC_URL}/${cfg.MINIO_BUCKET_ASSETS}/${key}`;
}

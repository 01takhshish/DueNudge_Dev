import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomToken } from '../../lib/crypto.js';
import { config } from '../../config.js';

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: Boolean(config.S3_ENDPOINT),
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID!,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/**
 * Direct-to-bucket upload: the browser PUTs to a presigned URL (5 min), the API never proxies bytes.
 * Object keys are namespaced by tenant so a listing can never mix tenants.
 */
export async function presignLogoUpload(
  tenantId: string,
  contentType: string,
  sizeBytes: number,
): Promise<{ uploadUrl: string; publicUrl: string; key: string } | null> {
  if (!config.s3Enabled) return null;
  const key = `tenants/${tenantId}/logo-${randomToken(8)}.${EXT[contentType] ?? 'bin'}`;
  const cmd = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
    CacheControl: 'public, max-age=31536000',
  });
  const uploadUrl = await getSignedUrl(s3(), cmd, { expiresIn: 300 });
  const base =
    config.S3_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? `${config.S3_ENDPOINT}/${config.S3_BUCKET}`;
  return { uploadUrl, publicUrl: `${base}/${key}`, key };
}

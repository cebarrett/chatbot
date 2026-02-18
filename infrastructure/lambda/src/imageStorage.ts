import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ImageChunkPayload } from './types';

const BUCKET_NAME = process.env.IMAGE_BUCKET_NAME;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const s3Client = new S3Client({ region: AWS_REGION });

/**
 * Upload a generated image to S3 and return the presigned URL and S3 key.
 */
export async function uploadImage(
  imageData: Buffer,
  mimeType: string,
  userId: string,
  chatId: string,
  messageId: string,
): Promise<{ s3Key: string; presignedUrl: string }> {
  if (!BUCKET_NAME) {
    throw new Error('IMAGE_BUCKET_NAME environment variable not set');
  }

  const extension = mimeType === 'image/webp' ? 'webp' : 'png';
  const uuid = crypto.randomUUID();
  const s3Key = `images/${userId}/${chatId}/${messageId}/${uuid}.${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: imageData,
    ContentType: mimeType,
  }));

  const presignedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }),
    { expiresIn: 86400 } // 24 hours
  );

  return { s3Key, presignedUrl };
}

/**
 * Generate a presigned URL for an existing S3 key.
 */
export async function getPresignedUrl(s3Key: string): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('IMAGE_BUCKET_NAME environment variable not set');
  }

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }),
    { expiresIn: 86400 } // 24 hours
  );
}

/**
 * Build an image chunk payload for publishing via AppSync subscription.
 */
export function buildImageChunkPayload(
  presignedUrl: string,
  mimeType: string,
  alt: string,
  width?: number,
  height?: number,
): string {
  const payload: ImageChunkPayload = {
    type: 'image',
    url: presignedUrl,
    mimeType,
    alt,
    width,
    height,
  };
  return JSON.stringify(payload);
}

import { ChunkBatcher } from '../chunkBatcher';
import { uploadImage, buildImageChunkPayload } from '../imageStorage';

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const IMAGE_MODEL = 'gpt-image-1.5';

const VALID_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);
const VALID_QUALITIES = new Set(['low', 'medium', 'high']);

/**
 * Generate images using OpenAI's /v1/images/generations endpoint.
 */
export async function streamOpenAIImage(
  apiKey: string,
  prompt: string,
  requestId: string,
  userId: string,
  chatId: string,
  options?: { size?: string; quality?: string },
): Promise<number> {
  const batcher = new ChunkBatcher(requestId, userId);

  try {
    const size = options?.size && VALID_SIZES.has(options.size) ? options.size : '1024x1024';
    const quality = options?.quality && VALID_QUALITIES.has(options.quality) ? options.quality : 'medium';

    const requestBody: Record<string, unknown> = {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size,
      quality,
      output_format: 'png',
    };

    const response = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check for content moderation rejection
      if (response.status === 400) {
        try {
          const errData = JSON.parse(errorText);
          if (errData.error?.code === 'content_policy_violation') {
            throw new Error('Image generation was blocked by content safety filters. Please try a different prompt.');
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('content safety')) throw e;
        }
      }
      throw new Error(`OpenAI Image API error: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();

    // Parse dimensions from the size string
    const [width, height] = size.split('x').map(Number);

    // Process each generated image
    const images = data.data || [];
    if (images.length === 0) {
      throw new Error('No images returned from OpenAI');
    }

    for (const image of images) {
      // OpenAI returns base64 when output_format is specified
      const base64Data = image.b64_json;
      if (!base64Data) {
        // If URL-based, we can't upload to S3 easily, but with output_format: png we get b64
        continue;
      }

      const imageBuffer = Buffer.from(base64Data, 'base64');

      const { presignedUrl } = await uploadImage(
        imageBuffer,
        'image/png',
        userId,
        chatId,
        requestId,
      );

      // Publish image chunk as JSON metadata
      const imageChunk = buildImageChunkPayload(
        presignedUrl,
        'image/png',
        prompt,
        width,
        height,
      );
      batcher.add(imageChunk);
    }

    // Estimate token usage for rate limiting (1 image = ~1000 tokens equivalent)
    const tokenCount = images.length * 1000;

    await batcher.done();
    return tokenCount;
  } catch (error) {
    await batcher.done(error instanceof Error ? error.message : 'Image generation error');
    throw error;
  }
}

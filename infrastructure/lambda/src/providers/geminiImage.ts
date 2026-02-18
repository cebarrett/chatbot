import { ChatMessageInput } from '../types';
import { ChunkBatcher } from '../chunkBatcher';
import { uploadImage, buildImageChunkPayload } from '../imageStorage';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const IMAGE_MODEL = 'gemini-3-pro-image-preview';

/**
 * Generate images using Gemini's generateContent API with responseModalities: ["TEXT", "IMAGE"].
 * The prompt is the last user message. Gemini can return multiple images and text in a single response.
 */
export async function streamGeminiImage(
  apiKey: string,
  prompt: string,
  requestId: string,
  userId: string,
  chatId: string,
): Promise<number> {
  const batcher = new ChunkBatcher(requestId, userId);

  try {
    const requestBody = {
      contents: [{
        role: 'user' as const,
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    };

    // Use non-streaming generateContent for image generation
    // (streaming with images returns partial data that's hard to reassemble)
    const url = `${GEMINI_API_BASE}/${IMAGE_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check for content moderation rejection
      if (response.status === 400 && errorText.includes('SAFETY')) {
        throw new Error('Image generation was blocked by content safety filters. Please try a different prompt.');
      }
      throw new Error(`Gemini Image API error: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const totalTokens = data.usageMetadata?.totalTokenCount || 0;

    // Check for blocked responses
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new Error('Image generation was blocked by content safety filters. Please try a different prompt.');
    }

    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts)) {
      throw new Error('No content in Gemini image response');
    }

    // Process parts: text parts are published as text chunks, image parts are uploaded to S3
    for (const part of parts) {
      if (part.text) {
        // Publish text content via the normal batcher
        batcher.add(part.text);
      } else if (part.inlineData) {
        // Image data: upload to S3 and publish as image chunk
        const { mimeType, data: base64Data } = part.inlineData;
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const { presignedUrl } = await uploadImage(
          imageBuffer,
          mimeType || 'image/png',
          userId,
          chatId,
          requestId,
        );

        // Publish image chunk as JSON metadata
        const imageChunk = buildImageChunkPayload(
          presignedUrl,
          mimeType || 'image/png',
          prompt,
          1024, // Gemini default
          1024,
        );
        batcher.add(imageChunk);
      }
    }

    await batcher.done();
    return totalTokens;
  } catch (error) {
    await batcher.done(error instanceof Error ? error.message : 'Image generation error');
    throw error;
  }
}

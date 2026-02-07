/**
 * Shared test helpers for mocking fetch responses and SSE streams.
 */

/**
 * Creates a mock Response with a ReadableStream body that emits SSE events.
 * Each event string should be a complete SSE line (e.g., 'data: {"type":"text"}').
 */
export function createMockSSEResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event + '\n'));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

/**
 * Creates a mock Response that returns JSON from `.json()`.
 */
export function createMockJSONResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Creates a mock error Response.
 */
export function createMockErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

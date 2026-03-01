/**
 * Fetches web search context using Perplexity's Sonar API to help judges
 * fact-check AI responses. Uses the lightweight 'sonar' model for fast,
 * cheap search-grounded results.
 */

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const SEARCH_MODEL = 'sonar';
const SEARCH_MAX_TOKENS = 1024;

/** Maximum length of AI response text to include in the search query */
const MAX_RESPONSE_FOR_SEARCH = 2000;

export interface WebSearchResult {
  /** Search-grounded factual context */
  context: string;
  /** Total tokens consumed by the search call */
  tokenCount: number;
}

/**
 * Fetches web search context related to a user prompt and AI response.
 * Returns factual information from web search that judges can use to
 * evaluate response accuracy.
 *
 * This is best-effort: returns null on any failure so that judge
 * evaluation can proceed without search context.
 */
export async function fetchWebSearchContext(
  apiKey: string,
  originalPrompt: string,
  responseToJudge: string
): Promise<WebSearchResult | null> {
  try {
    // Truncate response to keep the search query focused
    const truncatedResponse = responseToJudge.length > MAX_RESPONSE_FOR_SEARCH
      ? responseToJudge.substring(0, MAX_RESPONSE_FOR_SEARCH) + '...'
      : responseToJudge;

    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: SEARCH_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a fact-checking research assistant. Search the web for information relevant to the given topic. Provide a concise summary of key facts found, focusing on verifiable claims. Include source URLs when available. Be objective and factual.',
          },
          {
            role: 'user',
            content: `Find relevant web information to help fact-check the following AI response.

User's original question:
${originalPrompt}

AI response to verify:
${truncatedResponse}

Provide key facts and any corrections or confirmations of claims made in the response.`,
          },
        ],
        max_tokens: SEARCH_MAX_TOKENS,
      }),
    });

    if (!response.ok) {
      console.warn(`Web search context fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, any>;
    const content: string = data.choices?.[0]?.message?.content || '';
    const tokenCount: number = data.usage?.total_tokens || Math.ceil(content.length / 4);

    // Strip any extended thinking blocks
    const cleaned = content
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();

    if (!cleaned) {
      return null;
    }

    return { context: cleaned, tokenCount };
  } catch (error) {
    // Web search is supplementary — never block judge evaluation
    console.warn('Web search context error:', error);
    return null;
  }
}

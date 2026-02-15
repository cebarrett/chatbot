/**
 * Judge-specific instruction addenda.
 *
 * Each key is a ChatProvider enum value (e.g. 'OPENAI', 'PERPLEXITY').
 * The value is appended to the base system prompt when that provider acts
 * as a judge.  To add instructions for a new judge, add an entry here.
 */
export const JUDGE_PROVIDER_INSTRUCTIONS: Record<string, string> = {
  // Perplexity models are web-search-augmented and inherently bias toward
  // valuing citations/sources and treating search results as the sole source
  // of truth.  This addendum prevents unfair penalization of responses based
  // on the limitations of Perplexity's own web search results.
  PERPLEXITY: `

IMPORTANT EVALUATION GUIDELINES:
- Do NOT penalize responses for lacking citations, references, or source links. The AI assistants being evaluated are not expected to provide citations or URLs.
- Do NOT penalize or flag factual claims simply because they do not appear in your web search results. Your search results are limited and may not cover everything. A claim is not wrong just because you couldn't find it in a search.
- Use your own knowledge and reasoning to evaluate accuracy, not just your search results. Only flag claims as inaccurate if you have strong evidence they are actually wrong, not merely because they are unverified by your search.
- Evaluate responses purely on accuracy, helpfulness, completeness, and clarity of the content itself, the same way any other AI evaluator would.`,
};

/**
 * Returns the full system prompt for a given judge provider by appending
 * any provider-specific instructions to the base prompt.
 */
export function getJudgeSystemPrompt(basePrompt: string, provider: string): string {
  const addendum = JUDGE_PROVIDER_INSTRUCTIONS[provider];
  return addendum ? basePrompt + addendum : basePrompt;
}

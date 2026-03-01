/**
 * Judge-specific instruction addenda.
 *
 * Each key is a ChatProvider enum value (e.g. 'OPENAI').
 * The value is appended to the base system prompt when that provider acts
 * as a judge.  To add instructions for a new judge, add an entry here.
 */
export const JUDGE_PROVIDER_INSTRUCTIONS: Record<string, string> = {
  // ChatGPT tends to be overly nitpicky, flagging minor stylistic preferences
  // and non-issues as problems.  This addendum steers it toward evaluating
  // what actually matters: correctness, helpfulness, and clarity.
  OPENAI: `

IMPORTANT EVALUATION GUIDELINES:
- Focus on substance over style. Only flag issues that meaningfully affect the quality, correctness, or usefulness of the response.
- Do NOT flag minor stylistic choices, phrasing preferences, or formatting differences as problems. These are subjective and do not represent real quality issues.
- Do NOT penalize responses for being concise when the answer is complete. Brevity is a virtue, not a flaw.
- Do NOT penalize responses for omitting tangential information, edge cases, or caveats that the user did not ask about, unless the omission would lead to a genuinely incorrect or harmful outcome.
- Do NOT list "could have included more detail" or "could have mentioned X" as problems unless the missing information is critical to answering the user's question.
- Reserve the "problems" array for genuine errors, factual inaccuracies, misleading statements, or significant omissions that would cause the user real harm or confusion. An empty problems array is perfectly appropriate for a good response.
- A response that correctly and clearly answers the user's question is a good response (8+), even if you personally would have worded it differently.`,
};

/**
 * Returns the full system prompt for a given judge provider by appending
 * any provider-specific instructions to the base prompt.
 */
export function getJudgeSystemPrompt(basePrompt: string, provider: string): string {
  const addendum = JUDGE_PROVIDER_INSTRUCTIONS[provider];
  return addendum ? basePrompt + addendum : basePrompt;
}

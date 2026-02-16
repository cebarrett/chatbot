/**
 * Cost weights for token accounting.
 *
 * Each model has a weight relative to the most expensive model in its provider
 * family (weight = 1.0). When recording token usage against the daily quota,
 * the raw token count is multiplied by this weight. This means cheaper models
 * consume less of the user's daily quota, incentivizing their use for simpler
 * tasks.
 *
 * Weights approximate real API pricing ratios.
 */

const MODEL_COST_WEIGHTS: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6': 1.0,
  'claude-sonnet-4-5-20250929': 0.2,
  'claude-sonnet-4-20250514': 0.2,
  'claude-haiku-4-5-20251001': 0.05,

  // OpenAI
  'gpt-5.2': 1.0,

  // Google Gemini
  'gemini-3-pro-preview': 1.0,
  'gemini-3-flash-preview': 0.15,
  'gemini-2.5-pro': 0.8,
  'gemini-2.5-flash': 0.1,

  // xAI Grok
  'grok-4': 1.0,
  'grok-4.1': 1.0,

  // Perplexity
  'sonar-reasoning-pro': 1.0,
};

/** Default models per provider, used when no model override is specified. */
const DEFAULT_MODELS: Record<string, string> = {
  OPENAI: 'gpt-5.2',
  ANTHROPIC: 'claude-opus-4-6',
  GEMINI: 'gemini-3-pro-preview',
  PERPLEXITY: 'sonar-reasoning-pro',
  GROK: 'grok-4',
};

/**
 * Returns the cost weight for a given model.
 * Unknown models default to 1.0 (most expensive) to prevent gaming.
 */
export function getCostWeight(model: string): number {
  return MODEL_COST_WEIGHTS[model] ?? 1.0;
}

/**
 * Resolves the effective model string for a provider + optional override.
 */
export function resolveModel(provider: string, modelOverride?: string): string {
  return modelOverride || DEFAULT_MODELS[provider] || 'unknown';
}

/**
 * Applies cost weighting to a raw token count.
 * Returns the weighted token count (always at least 1 for non-zero input).
 */
export function weightedTokens(rawTokens: number, model: string): number {
  if (rawTokens <= 0) return 0;
  const weight = getCostWeight(model);
  return Math.max(1, Math.ceil(rawTokens * weight));
}

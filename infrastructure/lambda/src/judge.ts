import {
  AppSyncEvent,
  JudgeInput,
  JudgeResponse,
} from './types';
import { getSecrets } from './secrets';
import { judgeOpenAI, judgeAnthropic, judgeGemini } from './providers';

interface JudgeEventArgs {
  input: JudgeInput;
}

const JUDGE_PROMPT_TEMPLATE = `You are an expert AI response evaluator. Your task is to evaluate the quality of an AI assistant's response to a user's prompt.
{conversationHistory}
## User's Latest Prompt:
{originalPrompt}

## AI Assistant's Response (from {respondingProvider}):
{responseToJudge}

## Your Task:
Evaluate the response on a scale of 1.0 to 10.0, where:
- 1.0-3.0: Poor quality (incorrect, unhelpful, or harmful)
- 4.0-5.0: Below average (partially correct but missing key information)
- 6.0-7.0: Average (correct but could be improved)
- 8.0-9.0: Good (accurate, helpful, well-structured)
- 9.0-10.0: Excellent (comprehensive, insightful, perfectly addresses the prompt)

## Response Format:
You MUST respond with valid JSON in exactly this format:
{
  "score": <number between 1.0 and 10.0>,
  "explanation": "<brief explanation of your rating>",
  "problems": ["<problem 1>", "<problem 2>", ...]
}

If there are no problems, use an empty array: "problems": []

Respond ONLY with the JSON object, no additional text.`;

export async function handler(
  event: AppSyncEvent<JudgeEventArgs>
): Promise<JudgeResponse> {
  const { input } = event.arguments;
  const { judgeProvider, originalPrompt, responseToJudge, respondingProvider, conversationHistory, model } = input;
  const identity = event.identity;

  console.log(`Processing judge request with provider: ${judgeProvider}, user: ${identity.sub}`);

  try {
    // Get API keys from Secrets Manager
    const secrets = await getSecrets();

    // Format conversation history if provided
    let historySection = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const formatted = conversationHistory
        .map((m) => `**${m.role}**: ${m.content}`)
        .join('\n\n');
      historySection = `\n## Previous Conversation:\n${formatted}\n`;
    }

    // Build the judge prompt
    const prompt = JUDGE_PROMPT_TEMPLATE
      .replace('{conversationHistory}', historySection)
      .replace('{originalPrompt}', originalPrompt)
      .replace('{respondingProvider}', respondingProvider)
      .replace('{responseToJudge}', responseToJudge);

    // Call the appropriate provider
    let responseText: string;

    switch (judgeProvider) {
      case 'OPENAI':
        responseText = await judgeOpenAI(secrets.OPENAI_API_KEY, prompt, model);
        break;
      case 'ANTHROPIC':
        responseText = await judgeAnthropic(secrets.ANTHROPIC_API_KEY, prompt, model);
        break;
      case 'GEMINI':
        responseText = await judgeGemini(secrets.GEMINI_API_KEY, prompt, model);
        break;
      default:
        throw new Error(`Unknown judge provider: ${judgeProvider}`);
    }

    // Parse the response
    const parsed = parseJudgeResponse(responseText);

    return {
      ...parsed,
      judgeProvider: judgeProvider,
    };
  } catch (error) {
    console.error('Error processing judge request:', error);

    // Return a default error response
    return {
      score: 0,
      explanation: `Error evaluating response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      problems: ['Judge evaluation failed'],
      judgeProvider: judgeProvider,
    };
  }
}

function parseJudgeResponse(responseText: string): {
  score: number;
  explanation: string;
  problems: string[];
} {
  // Try to extract JSON from the response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('No JSON found in judge response');
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the response
    const score = typeof parsed.score === 'number'
      ? Math.min(10, Math.max(1, parsed.score))
      : 5;

    const explanation = typeof parsed.explanation === 'string'
      ? parsed.explanation
      : 'No explanation provided';

    const problems = Array.isArray(parsed.problems)
      ? parsed.problems.filter((p: unknown) => typeof p === 'string')
      : [];

    return { score, explanation, problems };
  } catch {
    throw new Error(`Failed to parse judge response: ${responseText.substring(0, 200)}`);
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from './env.js';

loadEnv();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 20 * 60 * 1000 });

export async function complete(systemPrompt: string, userPrompt: string, model = 'claude-sonnet-4-6', maxTokens = 4096): Promise<string> {
  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    if (message.stop_reason === 'refusal') {
      throw new Error('request refused by safety classifiers (stop_reason: refusal)');
    }

    const block = message.content.find((b) => b.type === 'text');
    if (block) return block.text;

    // Opus 5 occasionally ends a turn after thinking without emitting any text.
    // Retry rather than failing the whole run over one bad generation.
    lastError = new Error(
      `no text block in response (stop_reason: ${message.stop_reason}, content: ${JSON.stringify(message.content)})`
    );
    console.warn(`attempt ${attempt}/${maxAttempts}: ${lastError.message}`);
  }

  throw lastError;
}

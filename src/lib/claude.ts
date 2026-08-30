import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from './env.js';

loadEnv();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 20 * 60 * 1000 });

export async function complete(systemPrompt: string, userPrompt: string, model = 'claude-sonnet-4-6', maxTokens = 32000): Promise<string> {
  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Stream rather than a single blocking call: opus-5 turns on adaptive
    // thinking by default, and on a large generation the hidden thinking can
    // eat a non-streaming response's whole budget before any text is emitted
    // (turn ends with only an empty thinking block). Streaming with a generous
    // max_tokens gives the model room to actually write the output.
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new Error('request refused by safety classifiers (stop_reason: refusal)');
    }

    const block = message.content.find((b) => b.type === 'text');
    if (block) return block.text;

    // No text block: either the model ended the turn after thinking without
    // answering, or it hit the token cap mid-thinking. Retry rather than
    // failing the whole run over one bad generation.
    lastError = new Error(
      `no text block in response (stop_reason: ${message.stop_reason}, content: ${JSON.stringify(message.content)})`
    );
    console.warn(`attempt ${attempt}/${maxAttempts}: ${lastError.message}`);
  }

  throw lastError;
}

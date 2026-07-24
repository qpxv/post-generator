import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from './env.js';

loadEnv();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });

export async function complete(systemPrompt: string, userPrompt: string, model = 'claude-sonnet-4-6', maxTokens = 4096): Promise<string> {
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = message.content.find((b) => b.type === 'text');
  if (!block) throw new Error('no text block in response');
  return block.text;
}

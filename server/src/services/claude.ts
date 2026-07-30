import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set. Please set it in environment variables.');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function isConfigured(): boolean {
  return !!apiKey;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function sendMessage(
  systemPrompt: string,
  messages: ClaudeMessage[],
  options?: { maxTokens?: number }
): Promise<string> {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5-20251001',
    max_tokens: options?.maxTokens || 4096,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  });

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.text || '';
}

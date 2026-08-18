import Anthropic from '@anthropic-ai/sdk';

// Lazy accessors — read process.env at call time, not module load time
// (because dotenv.config() may not have run yet when this module is first imported)

function getApiKey() { return process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || ''; }
function getProvider() { return (process.env.AI_PROVIDER || 'openai').toLowerCase(); }
function getBaseUrl() { return process.env.AI_BASE_URL || 'https://api.openai.com/v1'; }
function getModel() { return process.env.AI_MODEL || 'gpt-4o-mini'; }
function getMaxTokens() { return Number(process.env.AI_MAX_TOKENS) || 4096; }
function getTimeoutMs() { return Number(process.env.AI_TIMEOUT_MS) || 180000; }

// ====== Interfaces ======
export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ====== Public API ======
export function isConfigured(): boolean {
  return !!getApiKey();
}

export function getConfig(): { provider: string; model: string; baseUrl: string } {
  return { provider: getProvider(), model: getModel(), baseUrl: getBaseUrl() };
}

export async function sendMessage(
  systemPrompt: string,
  messages: AiMessage[],
  options?: { maxTokens?: number }
): Promise<string> {
  if (!isConfigured()) {
    throw new Error('AI_API_KEY not set. Set AI_API_KEY (or ANTHROPIC_API_KEY) in environment variables.');
  }

  if (getProvider() === 'anthropic') {
    return sendAnthropic(systemPrompt, messages, options);
  }
  // Default: OpenAI-compatible
  return sendOpenAI(systemPrompt, messages, options);
}

// ====== Anthropic ======
let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: getApiKey() });
  }
  return anthropicClient;
}

async function sendAnthropic(
  systemPrompt: string,
  messages: AiMessage[],
  options?: { maxTokens?: number }
): Promise<string> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: getModel() || 'claude-sonnet-5-20251001',
    max_tokens: options?.maxTokens || getMaxTokens(),
    system: systemPrompt,
    messages: messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.text || '';
}

// ====== OpenAI-compatible (DeepSeek / Qwen / OpenAI / MiniMax / ...) ======
async function sendOpenAI(
  systemPrompt: string,
  messages: AiMessage[],
  options?: { maxTokens?: number }
): Promise<string> {
  const url = `${getBaseUrl().replace(/\/+$/, '')}/chat/completions`;
  const provider = getProvider();
  const apiKey = getApiKey();

  // MiniMax uses raw key, not "Bearer" prefix
  const authHeader = provider === 'minimax' ? apiKey : `Bearer ${apiKey}`;

  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.filter(m => m.role !== 'system'),
  ];

  const timeoutMs = getTimeoutMs();
  const deepSeekStructuredMode = provider === 'deepseek';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify({
      model: getModel(),
      messages: chatMessages,
      max_tokens: options?.maxTokens || getMaxTokens(),
      temperature: 0.7,
      // DeepSeek V4 defaults to thinking mode. Structured generation can spend
      // the complete max_tokens budget on reasoning_content and return an empty
      // final content. These calls all expect one JSON object, so use the faster
      // non-thinking mode and the provider's supported JSON response contract.
      ...(deepSeekStructuredMode ? {
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`AI API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices: Array<{
      finish_reason?: string | null;
      message: { content?: string | null; reasoning_content?: string | null };
    }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    const reasoningOnly = Boolean(choice?.message?.reasoning_content?.trim());
    throw new Error(`AI returned empty final content (finish_reason=${choice?.finish_reason ?? 'unknown'}, reasoning_only=${reasoningOnly})`);
  }
  return content;
}

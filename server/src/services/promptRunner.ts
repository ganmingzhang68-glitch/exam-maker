import type { z } from 'zod';
import { sendMessage } from './ai.js';
import { parsePromptOutput, renderPrompt, type PromptDefinition } from '../prompts/core.js';

export interface PromptRunResult<O> {
  promptId: string;
  promptVersion: string;
  output: O;
}

export async function runStructuredPrompt<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  definition: PromptDefinition<I, O>,
  input: z.input<I>,
  options?: { maxTokens?: number },
): Promise<PromptRunResult<z.output<O>>> {
  const rendered = renderPrompt(definition, input);
  const raw = await sendMessage(
    rendered.systemPrompt,
    [{ role: 'user', content: rendered.userPrompt }],
    options,
  );
  return {
    promptId: rendered.id,
    promptVersion: rendered.version,
    output: parsePromptOutput(definition, raw),
  };
}

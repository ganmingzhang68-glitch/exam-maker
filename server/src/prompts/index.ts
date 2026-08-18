export * from './core.js';
export * from './documentStructurePrompt.js';
export * from './questionParsingPrompt.js';
export * from './answerAlignmentPrompt.js';
export * from './taxonomyGenerationPrompt.js';
export * from './classificationPrompt.js';
export * from './templateExtractionPrompt.js';
export * from './blueprintGenerationPrompt.js';
export * from './generationPlanPrompt.js';
export * from './questionGenerationPrompt.js';
export * from './answerGenerationPrompt.js';
export * from './rubricGenerationPrompt.js';
export * from './independentValidationPrompt.js';
export * from './aiGradingPrompt.js';

import { documentStructurePrompt } from './documentStructurePrompt.js';
import { questionParsingPrompt } from './questionParsingPrompt.js';
import { answerAlignmentPrompt } from './answerAlignmentPrompt.js';
import { taxonomyGenerationPrompt } from './taxonomyGenerationPrompt.js';
import { classificationPrompt } from './classificationPrompt.js';
import { templateExtractionPrompt } from './templateExtractionPrompt.js';
import { blueprintGenerationPrompt } from './blueprintGenerationPrompt.js';
import { generationPlanPrompt } from './generationPlanPrompt.js';
import { questionGenerationPrompt } from './questionGenerationPrompt.js';
import { answerGenerationPrompt } from './answerGenerationPrompt.js';
import { rubricGenerationPrompt } from './rubricGenerationPrompt.js';
import { independentValidationPrompt } from './independentValidationPrompt.js';
import { aiGradingPrompt } from './aiGradingPrompt.js';

export const promptCatalog = [
  documentStructurePrompt,
  questionParsingPrompt,
  answerAlignmentPrompt,
  taxonomyGenerationPrompt,
  classificationPrompt,
  templateExtractionPrompt,
  blueprintGenerationPrompt,
  generationPlanPrompt,
  questionGenerationPrompt,
  answerGenerationPrompt,
  rubricGenerationPrompt,
  independentValidationPrompt,
  aiGradingPrompt,
] as const;

export function getPromptDefinition(id: typeof promptCatalog[number]['id']) {
  const definition = promptCatalog.find(item => item.id === id);
  if (!definition) throw new Error(`未知 Prompt: ${id}`);
  return definition;
}

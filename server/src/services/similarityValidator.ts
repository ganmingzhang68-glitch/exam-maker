function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/\d+(?:\.\d+)?/g, '#');
}

function ngrams(value: string, size = 3): Set<string> {
  const normalized = normalize(value);
  if (normalized.length <= size) return new Set(normalized ? [normalized] : []);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

export function questionSimilarity(left: string, right: string): number {
  const a = ngrams(left);
  const b = ngrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isTooSimilar(left: string, right: string, threshold = 0.72): boolean {
  return questionSimilarity(left, right) >= threshold;
}

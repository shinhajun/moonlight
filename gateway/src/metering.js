// The gateway is the billing source of truth: it estimates tokens from what it relays and
// clamps the agent's reported usage to within ±tolerance of that estimate.

// ~4 ASCII characters per token; other scripts (CJK, Hangul, …) about one per character.
export function estimateTokens(text) {
  let n = 0;
  for (const ch of text || '') n += ch.codePointAt(0) < 128 ? 0.25 : 1;
  return Math.ceil(n);
}

function contentText(content) {
  if (typeof content === 'string') return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: '', images: 0 };
  let text = '';
  let images = 0;
  for (const part of content) {
    if (part?.type === 'text') text += part.text || '';
    else images++;
  }
  return { text, images };
}

export function estimatePrompt(messages) {
  let tokens = 3;
  for (const m of messages) {
    const { text, images } = contentText(m.content);
    tokens += 4 + estimateTokens(text) + images * 256;
  }
  return tokens;
}

// Ollama streams about one token per chunk, so the chunk count is the better estimate unless it
// disagrees wildly with the text length (an agent batching or splitting chunks to game billing).
export function estimateOutput(chunks, text) {
  const byText = estimateTokens(text);
  return chunks >= byText * 0.5 && chunks <= byText * 2 ? chunks : byText;
}

export function clampUsage(reported, estimate, tolerance) {
  if (!Number.isFinite(reported) || reported < 0) return estimate;
  const lo = Math.floor(estimate * (1 - tolerance));
  const hi = Math.ceil(estimate * (1 + tolerance));
  return Math.round(Math.min(hi, Math.max(lo, reported)));
}

// micro-USD; prices are micro-USD per million tokens or per call.
export function priceCost(price, inputTokens, outputTokens) {
  const perTokens = (inputTokens * (price.in_per_m || 0) + outputTokens * (price.out_per_m || 0)) / 1e6;
  return Math.ceil(perTokens + (price.per_call || 0));
}

// One number to compare listings with different price shapes: the cost of a typical request.
export const unitPrice = (price) => priceCost(price, 500, 200);

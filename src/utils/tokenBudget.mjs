function estimateTextTokens(text) {
  if (!text) return 0;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return 0;
  return Math.ceil(clean.length / 4);
}

function extractText(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (part.type === 'input_text' || part.type === 'output_text') return part.text || '';
  if (part.type === 'function_call_output' || part.type === 'tool_output') return part.output || '';
  if (typeof part.text === 'string') return part.text;
  return '';
}

function estimateMessageTokens(message) {
  if (!message) return 0;
  if (typeof message.content === 'string') {
    return estimateTextTokens(message.content);
  }
  if (Array.isArray(message.content)) {
    return message.content.reduce((sum, part) => {
      if (part?.type === 'input_image' || part?.type === 'image') {
        const imageUrl =
          typeof part.image_url === 'string'
            ? part.image_url
            : typeof part.image_url?.url === 'string'
              ? part.image_url.url
              : '';
        if (!imageUrl) return sum;
        const payload = imageUrl.includes('base64,') ? imageUrl.split('base64,')[1] : imageUrl;
        return sum + Math.ceil(payload.length / 4);
      }
      return sum + estimateTextTokens(extractText(part));
    }, 0);
  }
  return estimateTextTokens(message.content?.text || '');
}

function estimateInputTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function trimInputToBudget(messages, maxTokens, reserveRatio = 0.75, protectedCount = 3) {
  if (!Array.isArray(messages) || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { removed: 0, tokens: estimateInputTokens(messages) };
  }
  const threshold = Math.floor(maxTokens * reserveRatio);
  let total = estimateInputTokens(messages);
  let removed = 0;
  while (total > threshold && messages.length > protectedCount + 1) {
    messages.splice(protectedCount, 1);
    removed += 1;
    total = estimateInputTokens(messages);
  }
  return { removed, tokens: total };
}

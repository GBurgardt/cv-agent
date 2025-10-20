function trimValue(value, max = 180) {
  if (!value) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function dedupeSentences(text) {
  if (!text) return '';
  const parts = text.split(/(?<=[.!?])\s+/);
  const seen = new Set();
  const unique = [];
  for (const raw of parts) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }
  return unique.join(' ');
}

function formatToolCall(call) {
  if (!call) return '';
  const status = call.ok ? 'ok' : 'error';
  const error = call.error ? ` (${trimValue(call.error, 80)})` : '';
  return `${call.name || 'tool'} [${status}]${error}`;
}

function formatSummaryEntry(entry) {
  if (!entry) return '';
  const toolSegment = entry.toolCalls?.length
    ? entry.toolCalls.map(formatToolCall).filter(Boolean).join(', ')
    : 'no tools';
  const details = [];
  if (typeof entry.fills === 'number') details.push(`fills ${entry.fills}`);
  if (entry.docxGenerated) details.push('docx ready');
  if (entry.lastError) details.push(`error: ${trimValue(entry.lastError, 90)}`);
  if (entry.note) details.push(trimValue(entry.note, 90));
  const detailSegment = details.length ? ` | ${details.join(' · ')}` : '';
  return `Iteration ${entry.iteration}: ${toolSegment}${detailSegment}`;
}

function extractTextFromResponse(response) {
  if (!response) return '';
  if (Array.isArray(response.output_text) && response.output_text.length) {
    return response.output_text.map((text) => text.trim()).filter(Boolean).join('\n');
  }
  const outputs = response.output || [];
  const parts = [];
  for (const block of outputs) {
    if (!block) continue;
    if (block.type === 'message') {
      const content = block.content || [];
      for (const item of content) {
        if (typeof item?.text === 'string') parts.push(item.text);
        if (item?.type === 'output_text' && typeof item.text === 'string') parts.push(item.text);
      }
    } else if (typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.map((text) => text.trim()).filter(Boolean).join('\n');
}

export async function generateIterationInsight({ client, model, history }) {
  if (!client) throw new Error('OpenAI client is required for iteration insight.');
  if (!model) throw new Error('Model is not defined for iteration insight.');

  const records = Array.isArray(history) ? history.slice(-5) : [];
  if (!records.length) return '';

  const context = records.map(formatSummaryEntry).filter(Boolean).join('\n');
  const prompt = [
    'CV agent context:',
    context,
    '',
    'Respond in concise English (one or two sentences). Summarize the current state and recommend the next concrete action. Avoid repetition.',
  ].join('\n');

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content:
          'You are an analyst summarizing the status of an automation agent. Output short, actionable insights without emojis.',
      },
      { role: 'user', content: prompt },
    ],
    max_output_tokens: 200,
  });

  const raw = extractTextFromResponse(response);
  return trimValue(dedupeSentences(raw), 280);
}

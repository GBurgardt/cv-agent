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
    : 'sin tools';
  const details = [];
  if (typeof entry.previewCount === 'number') details.push(`previews ${entry.previewCount}`);
  if (entry.correctionUsed) details.push('corrección aplicada');
  const needsCorrection =
    entry.initialFillDone &&
    !entry.correctionUsed &&
    typeof entry.previewCount === 'number' &&
    entry.previewCount > 0 &&
    !entry.exportSucceeded;
  if (needsCorrection) details.push('corrección pendiente');
  if (entry.exportSucceeded) details.push('export listo');
  if (!entry.exportSucceeded && entry.lastError) {
    details.push(`error: ${trimValue(entry.lastError, 90)}`);
  }
  if (entry.note) details.push(trimValue(entry.note, 90));
  const detailSegment = details.length ? ` | ${details.join(' · ')}` : '';
  return `Iteración ${entry.iteration}: ${toolSegment}${detailSegment}`;
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
  if (!client) throw new Error('OpenAI client requerido para iteration insight.');
  if (!model) throw new Error('Modelo no definido para iteration insight.');

  const records = Array.isArray(history) ? history.slice(-5) : [];
  if (!records.length) return '';

  const context = records.map(formatSummaryEntry).filter(Boolean).join('\n');
  const prompt = [
    'Contexto del agente CV:',
    context,
    '',
    'Respondé en español neutro con 1–2 líneas, tono práctico. Explicá qué está ocurriendo y qué acción concreta conviene intentar a continuación. Evitá repetir frases o ideas; si una sola oración alcanza, usala.',
  ].join('\n');

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content:
          'Sos un analista que resume el estado de un agente de automatización. Producciones breves, accionables y sin emojis.',
      },
      { role: 'user', content: prompt },
    ],
    max_output_tokens: 200,
  });

  const raw = extractTextFromResponse(response);
  return trimValue(dedupeSentences(raw), 280);
}

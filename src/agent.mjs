import OpenAI from 'openai';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { renderTemplateToPdf } from './tools/render.mjs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEBUG = process.env.CV_AGENT_DEBUG === '1';

const SYSTEM_PROMPT = `
Sos "CV Builder". Objetivo: transformar un CV PDF en un PDF final con un RESUMEN y SKILLS, usando un template HTML.

Reglas:
- El PDF del CV ya está adjunto: leelo y usá su contenido para preparar la respuesta.
- Luego, sintetizá en español neutro:
  • SUMMARY: 4–6 líneas (sin emojis, factual, orientado a reclutamiento).
  • SKILLS: top 8–14 habilidades/técnologías deduplicadas (case-insensitive).
  • Opcional: NAME, ROLE si se infiere claramente del CV (ej. primera línea/título).
- Cuando tengas los campos listos, llamá UNA vez a render_template_pdf(template_path, output_path, fields) con:
  {
    "fields": {
      "SUMMARY": "...",
      "SKILLS": ["...", "...", ...],
      "NAME": "...",
      "ROLE": "..."
    }
  }
- No devuelvas texto final al usuario hasta completar render_template_pdf.
- Tono: conciso, profesional, español neutro, sin emojis.

Si faltan NAME o ROLE, dejalos vacíos. Asegurate de que SKILLS sea una lista de strings simples.
`;

function toolsDefinition() {
  return [
    {
      type: 'function',
      name: 'render_template_pdf',
      description: 'Rellena un HTML template con placeholders y lo exporta a PDF.',
      parameters: {
        type: 'object',
        properties: {
          template_path: {
            type: 'string',
            description: 'Ruta al HTML template.',
          },
          output_path: {
            type: 'string',
            description: 'Ruta del PDF de salida.',
          },
          fields: {
            type: 'object',
            description: 'Mapa de campos a inyectar; ej. SUMMARY, SKILLS, NAME, ROLE.',
            additionalProperties: true,
          },
        },
        required: ['template_path', 'output_path', 'fields'],
        additionalProperties: false,
      },
    },
  ];
}

function extractToolCalls(resp) {
  const collected = [];
  const outputs = resp?.output || [];
  for (const block of outputs) {
    if (!block) continue;
    if (block.type === 'function_call' || block.type === 'tool_call' || block.type === 'custom_tool_call') {
      collected.push({
        call_id: block.call_id || block.id,
        name: block.name,
        input: block.arguments || block.input,
      });
      continue;
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item?.type === 'tool_call' || item?.type === 'custom_tool_call') {
          collected.push({
            call_id: item.call_id || item.id,
            name: item.name,
            input: item.input,
          });
        }
      }
    }
  }
  if (!collected.length && Array.isArray(resp?.tool_calls)) {
    return resp.tool_calls.map((call) => ({
      call_id: call.id,
      name: call.name,
      input: call.arguments,
    }));
  }
  return collected;
}

function makeToolOutput(callId, output) {
  return {
    type: 'function_call_output',
    call_id: callId,
    output: typeof output === 'string' ? output : JSON.stringify(output),
  };
}

function toInputContent(text) {
  return text;
}

export async function runCvAgent({ cvPath, outPath, templatePath, model }) {
  const debugLog = (...args) => {
    if (DEBUG) console.log('[cv-agent:debug]', ...args);
  };

  const absCv = path.resolve(cvPath);
  const absOut = path.resolve(outPath);
  const absTemplate = path.resolve(templatePath);

  debugLog('start', { cvPath: absCv, outPath: absOut, templatePath: absTemplate, modelOverride: model });
  console.log('[cv-agent] Generating resume…');

  await fsp.access(absCv);
  await fsp.access(absTemplate);

  let uploadedFileId;
  try {
    console.log('[cv-agent] Uploading PDF…');
    const uploaded = await openai.files.create({
      file: fs.createReadStream(absCv),
      purpose: 'user_data',
    });
    uploadedFileId = uploaded.id;
    debugLog('file-uploaded', uploadedFileId);

    const input = [
      { role: 'system', content: toInputContent(SYSTEM_PROMPT) },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Usá el PDF adjunto para generar el CV final con el template ${absTemplate} y guardalo en ${absOut}. ` +
              'Analizá el contenido, construí summary, skills, name y role antes de llamar a render_template_pdf.',
          },
          { type: 'input_file', file_id: uploadedFileId },
        ],
      },
    ];

    const tools = toolsDefinition();
    const modelId = model || process.env.OPENAI_MODEL || 'gpt-5-codex';

    let previousResponseId;
    let lastResponse = null;
    let finalText = '';
    let renderSucceeded = false;
    let lastRenderError = null;

    const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 128000);

    for (let turn = 0; turn < 6; turn += 1) {
      debugLog('turn', { turn: turn + 1 });
      const response = await openai.responses.create({
        model: modelId,
        input,
        tools,
        tool_choice: 'auto',
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: 'high', summary: 'auto' },
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      });

      debugLog('response', response);

      lastResponse = response;
      const toolCalls = extractToolCalls(response);

      debugLog('tool-calls', toolCalls);

      if (!toolCalls.length) {
        finalText = response?.output_text || '';
        debugLog('no-tool-call', { output: finalText });
        input.push({
          role: 'system',
          content: toInputContent(
            'Reminder: call render_template_pdf to generate the final PDF before responding.'
          ),
        });
        previousResponseId = response.id;
        continue;
      }

      let completed = false;
      for (const call of toolCalls) {
        const { name, call_id: callId } = call;
        let args = {};
        try {
          args = typeof call.input === 'string' ? JSON.parse(call.input) : call.input || {};
        } catch {
          args = {};
        }

        debugLog('tool-exec', { name, args });

        let result;
        if (name === 'render_template_pdf') {
          if (!args?.fields || typeof args.fields !== 'object') {
            console.log('[cv-agent] Crafting summary, skills, name and role…');
          }
          console.log('[cv-agent] Rendering template…');
          result = await renderTemplateToPdf({
            templatePath: args?.template_path || absTemplate,
            outputPath: args?.output_path || absOut,
            fields: args?.fields || {},
          });
          renderSucceeded = !!result?.ok;
          if (!renderSucceeded) {
            lastRenderError = result?.error || 'Fallo desconocido al renderizar.';
          } else {
            console.log('[cv-agent] Template rendered.');
            finalText = `PDF generated at ${absOut}`;
            completed = true;
          }
        } else {
          result = { ok: false, error: `Tool desconocida: ${name}` };
        }

        debugLog('tool-result', { name, result });
        input.push(makeToolOutput(callId, result));
      }

      previousResponseId = response.id;
      if (completed) break;
    }

    try {
      debugLog('render-flag', { renderSucceeded });
      await fsp.access(absOut);
      debugLog('output-exists', absOut);
    } catch {
      if (lastRenderError) {
        throw new Error(`No se generó el PDF de salida: ${lastRenderError}`);
      }
      throw new Error('No se generó el PDF de salida.');
    }

    if (!renderSucceeded) {
      debugLog('render-failure', lastRenderError);
      throw new Error(lastRenderError || 'La herramienta render_template_pdf no completó correctamente.');
    }

    const finalMessage = finalText || `PDF generated at ${absOut}`;
    debugLog('final-message', finalMessage);
    console.log(`[cv-agent] Done. PDF generated at ${absOut}`);

    return {
      outputPath: absOut,
      raw: finalMessage,
      response: lastResponse,
    };
  } finally {
    if (uploadedFileId) {
      debugLog('file-delete', uploadedFileId);
      try {
        await openai.files.del(uploadedFileId);
      } catch (err) {
        debugLog('file-delete-error', err?.message || err);
      }
    }
  }
}

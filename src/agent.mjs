import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { readPdfText } from './tools/pdf.mjs';
import { renderTemplateToPdf } from './tools/render.mjs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
Sos "CV Builder". Objetivo: transformar un CV PDF en un PDF final con un RESUMEN y SKILLS, usando un template HTML.

Reglas:
- SIEMPRE llamá primero a read_cv_pdf(path) para obtener el texto plano del CV.
- Luego, sintetizá en español neutro:
  • SUMMARY: 4–6 líneas (sin emojis, factual, orientado a reclutamiento).
  • SKILLS: top 8–14 habilidades/técnologías deduplicadas (case-insensitive).
  • Opcional: NAME, ROLE si se infiere claramente del CV (ej. primera línea/título).
- Después, UNA SOLA llamada a render_template_pdf(template_path, output_path, fields) con:
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
No intentes responder directamente al usuario hasta haber llamado a read_cv_pdf y render_template_pdf (en ese orden).
`;

function toolsDefinition() {
  return [
    {
      type: 'function',
      name: 'read_cv_pdf',
      description: 'Lee texto del archivo PDF de un CV. Retorna { text }.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Ruta absoluta o relativa al archivo PDF.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
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
  const absCv = path.resolve(cvPath);
  const absOut = path.resolve(outPath);
  const absTemplate = path.resolve(templatePath);

  console.log('[agent] Iniciando cv-agent');
  console.log(`[agent] cvPath=${absCv}`);
  console.log(`[agent] outPath=${absOut}`);
  console.log(`[agent] templatePath=${absTemplate}`);
  console.log(`[agent] model=${model || process.env.OPENAI_MODEL || 'gpt-5-codex'}`);

  await fs.access(absCv);
  await fs.access(absTemplate);

  const input = [
    { role: 'system', content: toInputContent(SYSTEM_PROMPT) },
    {
      role: 'user',
      content: toInputContent(
        `Procesá este CV PDF en: ${absCv}.
Usá el template: ${absTemplate}
El PDF de salida debe ser: ${absOut}`
      ),
    },
  ];

  const tools = toolsDefinition();
  const modelId = model || process.env.OPENAI_MODEL || 'gpt-5-codex';

  let previousResponseId;
  let lastResponse = null;
  let finalText = '';
  let renderSucceeded = false;
  let lastRenderError = null;
  const requiredToolPlan = ['read_cv_pdf', 'render_template_pdf'];
  let requiredToolIndex = 0;

  const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 128000);

  for (let turn = 0; turn < 6; turn += 1) {
    const forcedTool = requiredToolPlan[requiredToolIndex] || null;
    const toolChoiceParam = forcedTool
      ? { type: 'function', name: forcedTool }
      : 'auto';
    console.log(`[agent] tool_choice usado en este turno: ${JSON.stringify(toolChoiceParam)}`);

    console.log(`\n[agent] ===== Turno ${turn + 1} =====`);
    const response = await openai.responses.create({
      model: modelId,
      input,
      tools,
      tool_choice: toolChoiceParam,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: 'high', summary: 'auto' },
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    });

    console.log('[agent] respuesta recibida, id:', response?.id);
    console.log('[agent] response.debug:', JSON.stringify(response, null, 2));

    lastResponse = response;
    const toolCalls = extractToolCalls(response);

    if (!toolCalls.length) {
      console.log('[agent] No hay tool calls en este turno.');
    } else {
      console.log(`[agent] tool calls (${toolCalls.length}):`, toolCalls.map((call) => call.name).join(', '));
    }

    if (!toolCalls.length) {
      finalText = response?.output_text || '';
      console.warn('[agent] No se recibió tool call. Recordatorio explícito agregado.');
      console.warn('[agent] output_text:', finalText);
      if (forcedTool) {
        input.push({
          role: 'system',
          content: toInputContent(
            `Necesito que llames inmediatamente a la herramienta ${forcedTool}. No produzcas respuesta final hasta completarlo.`
          ),
        });
      } else {
        input.push({
          role: 'system',
          content: toInputContent(
            'Recordatorio: debes utilizar la herramienta render_template_pdf para generar el CV final antes de responder al usuario.'
          ),
        });
      }
      input.push({
        role: 'system',
        content: toInputContent(
          'Recordatorio: Debes utilizar primero la herramienta read_cv_pdf con el path provisto y luego render_template_pdf para generar el PDF. No entregues respuesta final hasta completar ambas herramientas.'
        ),
      });
      continue;
    }

    for (const call of toolCalls) {
      const { name, call_id: callId } = call;
      let args = {};
      try {
        args = typeof call.input === 'string' ? JSON.parse(call.input) : call.input || {};
      } catch {
        args = {};
      }

      let result;
      if (name === 'read_cv_pdf') {
        console.log(`[agent] Ejecutando ${name} con args`, args);
        result = await readPdfText(args?.path);
      } else if (name === 'render_template_pdf') {
        console.log(`[agent] Ejecutando ${name} con args`, args);
        result = await renderTemplateToPdf({
          templatePath: args?.template_path || absTemplate,
          outputPath: args?.output_path || absOut,
          fields: args?.fields || {},
        });
        renderSucceeded = !!result?.ok;
        if (!renderSucceeded) {
          lastRenderError = result?.error || 'Fallo desconocido al renderizar.';
        }
      } else {
        result = { ok: false, error: `Tool desconocida: ${name}` };
      }

      console.log(`[agent] Resultado ${name}:`, result);
      input.push(makeToolOutput(callId, result));

      if (forcedTool && name === forcedTool && result?.ok) {
        requiredToolIndex += 1;
        console.log(
          `[agent] Tool ${name} ejecutada correctamente. Avanzando plan (${requiredToolIndex}/${requiredToolPlan.length}).`
        );
      }
    }

    previousResponseId = response.id;
  }

  try {
    console.log(`[agent] renderSucceeded flag: ${renderSucceeded}`);
    await fs.access(absOut);
    console.log(`[agent] Validación final: archivo ${absOut} encontrado.`);
  } catch {
    if (lastRenderError) {
      throw new Error(`No se generó el PDF de salida: ${lastRenderError}`);
    }
    throw new Error('No se generó el PDF de salida.');
  }

  if (!renderSucceeded) {
    console.error('[agent] render_template_pdf no reportó éxito.');
    throw new Error(lastRenderError || 'La herramienta render_template_pdf no completó correctamente.');
  }

  console.log('[agent] Proceso finalizado correctamente.');
  if (finalText) {
    console.log('[agent] Texto final del modelo:', finalText);
  }

  return {
    outputPath: absOut,
    raw: finalText,
    response: lastResponse,
  };
}

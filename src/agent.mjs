import OpenAI from 'openai';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fillTemplateHtml } from './tools/fillTemplate.mjs';
import { previewResumeSnapshot } from './tools/previewSnapshot.mjs';
import { exportResumePdf } from './tools/exportPdf.mjs';

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
- Trabajá con estos pasos:
  1. Usá fill_template_html(template_path, output_html_path, fields) para volcar los datos en el HTML de trabajo.
  2. Usá preview_resume_snapshot(html_path, image_path?) para generar una vista previa. Revisala; si hay errores, ajustá los campos y repetí.
  3. Cuando todo esté bien, llamá export_resume_pdf(html_path, output_pdf_path) para producir el PDF final.
- No devuelvas texto final al usuario hasta completar export_resume_pdf.
- Tono: conciso, profesional, español neutro, sin emojis.

Si faltan NAME o ROLE, dejalos vacíos. Asegurate de que SKILLS sea una lista de strings simples.
`;

function toolsDefinition() {
  return [
    {
      type: 'function',
      name: 'fill_template_html',
      description: 'Genera un HTML completo reemplazando placeholders por los campos indicados.',
      parameters: {
        type: 'object',
        properties: {
          template_path: { type: 'string', description: 'Ruta del template base (HTML con placeholders).' },
          output_html_path: { type: 'string', description: 'Ruta donde guardar el HTML de trabajo.' },
          fields: {
            type: 'object',
            description: 'Campos a inyectar. Ej: {"SUMMARY": "...", "SKILLS": [...], "NAME": "", "ROLE": ""}.',
            additionalProperties: true,
          },
        },
        required: ['template_path', 'output_html_path', 'fields'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'preview_resume_snapshot',
      description: 'Genera una captura del HTML actual y la sube para revisión visual.',
      parameters: {
        type: 'object',
        properties: {
          html_path: { type: 'string', description: 'Ruta al HTML que se quiere previsualizar.' },
          image_path: { type: 'string', description: 'Ruta donde guardar la captura PNG.' },
          width: { type: 'integer', description: 'Ancho opcional de viewport en px.' },
          height: { type: 'integer', description: 'Alto opcional de viewport en px.' },
        },
        required: ['html_path'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'export_resume_pdf',
      description: 'Convierte el HTML final en un PDF definitivo.',
      parameters: {
        type: 'object',
        properties: {
          html_path: { type: 'string', description: 'Ruta del HTML final.' },
          output_pdf_path: { type: 'string', description: 'Ruta del PDF a generar.' },
        },
        required: ['html_path', 'output_pdf_path'],
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
  const logAction = (msg) => console.log(`• ${msg}`);
  const logDetail = (msg) => console.log(`  └ ${msg}`);

  const absCv = path.resolve(cvPath);
  const absOut = path.resolve(outPath);
  const absTemplate = path.resolve(templatePath);
  const workingHtmlPath = path.resolve(path.dirname(absOut), 'resume-working.html');
  const previewImagePath = path.resolve(path.dirname(absOut), 'resume-preview.png');

  debugLog('start', { cvPath: absCv, outPath: absOut, templatePath: absTemplate, modelOverride: model });
  logAction('Generating resume…');

  await fsp.access(absCv);
  await fsp.access(absTemplate);

  const tempFiles = [];
  const snapshotFileIds = [];
  let uploadedFileId;
  let lastHtmlPath = workingHtmlPath;

  try {
    logAction('Uploading source PDF…');
    const uploaded = await openai.files.create({
      file: fs.createReadStream(absCv),
      purpose: 'user_data',
    });
    uploadedFileId = uploaded.id;
    logDetail(`file_id: ${uploadedFileId}`);

    const input = [
      { role: 'system', content: toInputContent(SYSTEM_PROMPT) },
      {
        role: 'system',
        content: toInputContent(
          `Paths sugeridos:\n- TEMPLATE_PATH: ${absTemplate}\n- WORKING_HTML_PATH: ${workingHtmlPath}\n- PREVIEW_IMAGE_PATH: ${previewImagePath}\n- OUTPUT_PDF_PATH: ${absOut}\nSeguí el flujo fill_template_html → preview_resume_snapshot → export_resume_pdf.`
        ),
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Tenés el CV adjunto. Construí el HTML, revisá la vista previa y recién después exportá el PDF final.',
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
    let exportSucceeded = false;
    let lastError = null;

    const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 128000);

    turnLoop: for (let turn = 0; turn < 8; turn += 1) {
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
        logAction('Model responded without tool call; reminding about export.');
        input.push({
          role: 'system',
          content: toInputContent('Recordá finalizar con export_resume_pdf una vez que la vista previa esté aprobada.'),
        });
        previousResponseId = response.id;
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

        debugLog('tool-exec', { name, args });

        let result;

        if (name === 'fill_template_html') {
          const templatePathArg = args?.template_path || absTemplate;
          const outputHtmlPath = args?.output_html_path || workingHtmlPath;
          logAction('Calling fill_template_html');
          logDetail(`template_path: ${templatePathArg}`);
          logDetail(`output_html_path: ${outputHtmlPath}`);
          try {
            result = await fillTemplateHtml({
              templatePath: templatePathArg,
              outputHtmlPath,
              fields: args?.fields || {},
            });
          } catch (err) {
            result = { ok: false, error: err?.message || String(err) };
            logDetail(`error: ${result.error}`);
          }
          if (result?.html_path) {
            lastHtmlPath = result.html_path;
            logDetail(`html_path: ${lastHtmlPath}`);
          }
        } else if (name === 'preview_resume_snapshot') {
          const htmlPath = args?.html_path || lastHtmlPath;
          const imagePath = args?.image_path || previewImagePath;
          logAction('Calling preview_resume_snapshot');
          logDetail(`html_path: ${htmlPath}`);
          logDetail(`image_path: ${imagePath}`);
          try {
            result = await previewResumeSnapshot({
              htmlPath,
              imagePath,
              width: args?.width,
              height: args?.height,
            });
          } catch (err) {
            result = { ok: false, error: err?.message || String(err) };
            logDetail(`error: ${result.error}`);
          }
          if (result?.image_path) tempFiles.push(result.image_path);
          if (result?.image_file_id) {
            snapshotFileIds.push(result.image_file_id);
            logDetail(`image_file_id: ${result.image_file_id}`);
          }
        } else if (name === 'export_resume_pdf') {
          const htmlPath = args?.html_path || lastHtmlPath;
          const pdfPath = args?.output_pdf_path || absOut;
          logAction('Calling export_resume_pdf');
          logDetail(`html_path: ${htmlPath}`);
          logDetail(`output_pdf_path: ${pdfPath}`);
          try {
            result = await exportResumePdf({ htmlPath, outputPdfPath: pdfPath });
            exportSucceeded = !!result?.ok;
            if (!exportSucceeded) {
              lastError = result?.error || 'Fallo desconocido al exportar.';
              logDetail(`error: ${lastError}`);
            } else {
              finalText = `PDF generated at ${pdfPath}`;
              logDetail('Export completed.');
            }
          } catch (err) {
            exportSucceeded = false;
            lastError = err?.message || String(err);
            result = { ok: false, error: lastError };
            logDetail(`error: ${lastError}`);
          }
        } else {
          result = { ok: false, error: `Tool desconocida: ${name}` };
        }

        debugLog('tool-result', { name, result });
        input.push(makeToolOutput(callId, result));

        if (name === 'preview_resume_snapshot' && result?.image_file_id) {
          logAction('Preview ready for review.');
          input.push({
            role: 'user',
            content: [
              { type: 'input_text', text: 'Snapshot del CV actual. Revisá el layout y ajustá si hace falta.' },
              { type: 'input_image', image_file: { file_id: result.image_file_id } },
            ],
          });
          previousResponseId = response.id;
          continue turnLoop;
        }

        if (name === 'export_resume_pdf' && exportSucceeded) {
          break turnLoop;
        }
      }

      previousResponseId = response.id;
    }

    try {
      debugLog('export-status', { exportSucceeded });
      await fsp.access(absOut);
    } catch {
      if (lastError) throw new Error(`No se generó el PDF de salida: ${lastError}`);
      throw new Error('No se generó el PDF de salida.');
    }

    if (!exportSucceeded) {
      throw new Error(lastError || 'export_resume_pdf no completó correctamente.');
    }

    const finalMessage = finalText || `PDF generated at ${absOut}`;
    debugLog('final-message', finalMessage);
    logAction(`Done. PDF generated at ${absOut}`);

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
    for (const snapshotId of snapshotFileIds) {
      try {
        await openai.files.del(snapshotId);
      } catch (err) {
        debugLog('snapshot-delete-error', err?.message || err);
      }
    }
    for (const tempPath of tempFiles) {
      try {
        await fsp.unlink(tempPath);
      } catch (err) {
        debugLog('temp-delete-error', { tempPath, error: err?.message || err });
      }
    }
  }
}

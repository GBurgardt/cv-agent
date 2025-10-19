import OpenAI from 'openai';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fillTemplateHtml } from './tools/fillTemplate.mjs';
import { previewResumeSnapshot } from './tools/previewSnapshot.mjs';
import { exportResumePdf } from './tools/exportPdf.mjs';
import { generateIterationInsight } from './tools/iterationInsight.mjs';
import { trimInputToBudget } from './utils/tokenBudget.mjs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEBUG = process.env.CV_AGENT_DEBUG === '1';
// gpt-5-codex expone un contexto de ~200k tokens según documentación pública:
// https://github.com/openai/codex/issues/2002
const MODEL_CONTEXT_LIMIT = Number(process.env.MODEL_CONTEXT_LIMIT ?? 200000);
const CONTEXT_RESERVE_RATIO = Number(process.env.CONTEXT_RESERVE_RATIO ?? 0.6);

const SYSTEM_PROMPT = `
Sos "CV Builder". Objetivo: transformar un CV PDF en un PDF final con un RESUMEN y SKILLS, usando un template HTML.

Reglas:
- El PDF del CV ya está adjunto: leelo y usá su contenido para preparar la respuesta.
- Luego, sintetizá en español neutro:
  • SUMMARY: 4–6 líneas (sin emojis, factual, orientado a reclutamiento).
  • SKILLS: top 8–14 habilidades/técnologías deduplicadas (case-insensitive) en un listado plano.
  • LANGUAGES: lista de idiomas con nivel (ej. Español — Nativo).
  • KEY INDUSTRIES: sectores relevantes (ej. Fintech, Retail, Energía).
  • EDUCATION: entradas con institución + título + período.
  • EXPERIENCE: lista cronológica de roles (role, company, period, location, summary, bullets opcionales, tech opcional).
  • NAME y ROLE si se infiere claramente del CV (ej. primera línea/título).
- Tratá cada mensaje que empiece con "Insight iteración" como una instrucción de más alto nivel: si indica revisar o corregir, hacelo antes de decidir la siguiente acción; si ya cumpliste, confirmalo explícitamente en tu razonamiento.
- Flujo obligatorio y ordenado:
  1. Ejecutá fill_template_html(template_path, output_html_path, fields) para construir el HTML base.
  2. Generá una única vista previa con preview_resume_snapshot(html_path, image_path?). No vas a poder pedir otra captura, así que evaluá cuidadosamente el layout.
  3. Analizá la captura, describí qué hay que ajustar y aplicá exactamente una corrección con fill_template_html. Confirmá en texto los cambios realizados; no habrá otra oportunidad de preview.
  4. Una vez aplicada la corrección (y sin previews disponibles), describí el estado final y llamá export_resume_pdf(html_path, output_pdf_path) para producir el PDF definitivo. Si aún falta algo, dejalo documentado antes de exportar.
- Cada llamada a fill_template_html debe incluir en fields todas las claves del template: SUMMARY, SKILLS, LANGUAGES, INDUSTRIES, EDUCATION, EXPERIENCE, NAME y ROLE (cuando apliquen).
- No devuelvas texto final al usuario hasta completar export_resume_pdf.
- En cada revisión explicá en texto qué viste en la imagen (qué se ve bien o mal) antes de decidir rellenar nuevamente.
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

function createAgentState(initialHtmlPath, maxPreviews) {
  return {
    previewCount: 0,
    maxPreviews,
    initialFillDone: false,
    correctionUsed: false,
    lastHtmlPath: initialHtmlPath,
    exportSucceeded: false,
    finalText: '',
    lastError: null,
  };
}

function ensureContextBudget(messages, logDetail) {
  const { removed, tokens } = trimInputToBudget(
    messages,
    MODEL_CONTEXT_LIMIT,
    CONTEXT_RESERVE_RATIO
  );
  const status = `${tokens}/${MODEL_CONTEXT_LIMIT}`;
  if (removed > 0) {
    logDetail(
      `context trimmed: removed ${removed} mensaje(s) antiguo(s), tokens aprox. ${status}.`
    );
  } else {
    logDetail(`context tokens aprox.: ${status}`);
  }
  return { removed, tokens };
}

function sanitizeSnapshotResult(result) {
  if (!result || typeof result !== 'object') return result;
  const sanitized = { ...result };
  if ('image_base64' in sanitized) sanitized.image_base64 = undefined;
  return sanitized;
}

function buildSnapshotMessages(base64, state) {
  if (!base64) return [];
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Snapshot del CV actual. Revisá el layout y ajustá si hace falta.' },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${base64}` },
      ],
    },
  ];
  if (state.previewCount >= state.maxPreviews) {
    messages.push({
      role: 'system',
      content: toInputContent(
        'Ya usaste la única vista previa disponible. Documentá cualquier pendiente en texto y continuá con la exportación.'
      ),
    });
  }
  return messages;
}

function derivePreviewNote(state) {
  if (!state.previewCount) return '';
  if (!state.correctionUsed) {
    return 'Falta aplicar la corrección posterior a la única vista previa antes de exportar.';
  }
  if (state.previewCount >= state.maxPreviews) {
    return 'Vista previa agotada tras la corrección. Documentá el estado y procedé a exportar.';
  }
  return 'Corrección aplicada; documentá los cambios antes de exportar.';
}

function deriveIterationNote(state, currentNote) {
  if (currentNote) return currentNote;
  if (state.exportSucceeded) {
    return 'Export completada; confirmá el cierre y compartí la ruta final.';
  }
  if (state.previewCount >= state.maxPreviews) {
    return state.correctionUsed
      ? 'Única vista previa agotada con corrección aplicada; procedé a exportar.'
      : 'Única vista previa agotada sin corrección; documentá pendientes antes de exportar.';
  }
  if (state.previewCount > 0 && !state.correctionUsed) {
    return 'Corrección posterior a la vista previa aún pendiente.';
  }
  if (!state.initialFillDone) {
    return 'Generá el HTML base antes de intentar la vista previa.';
  }
  return '';
}

function createToolHandlers(context) {
  const {
    logAction,
    logDetail,
    paths,
    tempFiles,
    state,
  } = context;

  const executeFillTemplate = async (args = {}) => {
    const templatePathArg = args?.template_path || paths.template;
    const outputHtmlPath = args?.output_html_path || paths.workingHtml;
    let result;

    if (!state.initialFillDone) {
      state.initialFillDone = true;
    } else if (state.previewCount === 0) {
      result = {
        ok: false,
        error: 'Ya rellenaste el template base. Revisá la vista previa antes de intentar otra corrección.',
      };
      logDetail('second fill before preview blocked.');
    } else if (!state.correctionUsed) {
      state.correctionUsed = true;
    } else if (state.previewCount >= state.maxPreviews) {
      result = {
        ok: false,
        error: 'Alcanzaste el límite de previsualizaciones. Exportá el PDF o detallá el problema.',
      };
      logDetail('correction blocked after reaching preview limit.');
    } else {
      result = {
        ok: false,
        error: 'Ya aplicaste la corrección permitida. Exportá el PDF o describí el problema.',
      };
      logDetail('additional correction blocked after preview.');
    }

    if (!result) {
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
        state.lastHtmlPath = result.html_path;
        logDetail(`html_path: ${state.lastHtmlPath}`);
      }
    }

    return {
      conversationResult: result,
      recordResult: result,
      extraMessages: [],
      continueLoop: false,
      exitLoop: false,
      note: '',
    };
  };

  const executePreview = async (args = {}) => {
    let result;
    if (state.previewCount >= state.maxPreviews) {
      logDetail('preview limit reached; preview_resume_snapshot skipped.');
      result = { ok: false, error: 'Límite de previsualizaciones alcanzado.' };
    } else {
      const htmlPath = args?.html_path || state.lastHtmlPath;
      const imagePath = args?.image_path || paths.previewImage;
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
      if (result?.image_base64) {
        logDetail(`preview_base64_length: ${result.image_base64.length}`);
      }
    }

    const sanitized = sanitizeSnapshotResult(result);
    const recordResult = sanitizeSnapshotResult(result);
    const extraMessages = [];
    let note = '';
    let continueLoop = false;

    if (result?.image_base64) {
      state.previewCount += 1;
      logDetail(`previews used: ${state.previewCount} / ${state.maxPreviews}`);
      logAction('Preview ready for review.');
      try {
        if (result?.image_path) {
          await fsp.access(result.image_path);
        }
      } catch {
        logDetail('preview image missing on disk (ignorado).');
      }
      extraMessages.push(...buildSnapshotMessages(result.image_base64, state));
      note = derivePreviewNote(state);
      continueLoop = true;
    }

    return {
      conversationResult: sanitized,
      recordResult,
      extraMessages,
      continueLoop,
      exitLoop: false,
      note,
    };
  };

  const executeExport = async (args = {}) => {
    let result;
    if (state.previewCount === 0) {
      result = {
        ok: false,
        error: 'Generá al menos una vista previa y revisá el layout antes de exportar el PDF.',
      };
      logDetail('export blocked: preview missing.');
    } else if (!state.correctionUsed) {
      result = {
        ok: false,
        error: 'Aplicá la corrección posterior a la vista previa con fill_template_html antes de exportar.',
      };
      logDetail('export blocked: pending post-preview correction.');
    } else {
      const htmlPath = args?.html_path || state.lastHtmlPath;
      const pdfPath = args?.output_pdf_path || paths.pdfOut;
      logAction('Calling export_resume_pdf');
      logDetail(`html_path: ${htmlPath}`);
      logDetail(`output_pdf_path: ${pdfPath}`);
      try {
        result = await exportResumePdf({ htmlPath, outputPdfPath: pdfPath });
        state.exportSucceeded = !!result?.ok;
        if (!state.exportSucceeded) {
          state.lastError = result?.error || 'Fallo desconocido al exportar.';
          logDetail(`error: ${state.lastError}`);
        } else {
          state.finalText = `PDF generated at ${pdfPath}`;
          logDetail('Export completed.');
        }
      } catch (err) {
        state.exportSucceeded = false;
        state.lastError = err?.message || String(err);
        result = { ok: false, error: state.lastError };
        logDetail(`error: ${state.lastError}`);
      }
    }

    return {
      conversationResult: result,
      recordResult: result,
      extraMessages: [],
      continueLoop: false,
      exitLoop: state.exportSucceeded,
      note: '',
    };
  };

  return {
    fill_template_html: executeFillTemplate,
    preview_resume_snapshot: executePreview,
    export_resume_pdf: executeExport,
  };
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
  await fsp.access(absCv);
  await fsp.access(absTemplate);

  const tempFiles = [];
  let uploadedFileId;

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

    const MAX_PREVIEWS = 1;
    const agentState = createAgentState(workingHtmlPath, MAX_PREVIEWS);
    const iterationHistory = [];
    const insightModelId = process.env.OPENAI_INSIGHT_MODEL || modelId;
    const paths = {
      template: absTemplate,
      workingHtml: workingHtmlPath,
      previewImage: previewImagePath,
      pdfOut: absOut,
    };
    const toolHandlers = createToolHandlers({
      logAction,
      logDetail,
      paths,
      tempFiles,
      state: agentState,
    });

    const appendIterationInsight = async ({ iteration, actions, note }) => {
      const summaryEntry = {
        iteration,
        toolCalls: (actions || []).map(({ name, result }) => ({
          name,
          ok: result?.ok !== false,
          error: result?.error,
        })),
        previewCount: agentState.previewCount,
        initialFillDone: agentState.initialFillDone,
        correctionUsed: agentState.correctionUsed,
        exportSucceeded: agentState.exportSucceeded,
        lastError: agentState.lastError,
        note,
      };
      iterationHistory.push(summaryEntry);
      const historySlice = iterationHistory.slice(-3);
      try {
        const insight = await generateIterationInsight({
          client: openai,
          model: insightModelId,
          history: historySlice,
        });
        if (insight) {
          logAction(`Insight iteración ${iteration}`);
          logDetail(insight);
          input.push({
            role: 'system',
            content: toInputContent(`Insight iteración ${iteration}: ${insight}`),
          });
        }
      } catch (err) {
        debugLog('insight-error', err?.message || err);
      }
    };

turnLoop: for (let turn = 0; turn < 8; turn += 1) {
      const iteration = turn + 1;
      debugLog('turn', { turn: iteration });
      ensureContextBudget(input, logDetail);
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

      const iterationActions = [];
      let iterationNote = '';
      let exitLoop = false;

      if (!toolCalls.length) {
        logAction(`Iteration ${iteration}: no tool calls received.`);
        logAction('Model responded without tool call; reminding about export.');
        input.push({
          role: 'system',
          content: toInputContent('Recordá finalizar con export_resume_pdf una vez que la vista previa esté aprobada.'),
        });
        iterationNote = 'Sin tool calls; se envió recordatorio.';
        await appendIterationInsight({ iteration, actions: iterationActions, note: iterationNote });
        previousResponseId = response.id;
        continue;
      }

      logAction(`Iteration ${iteration}: model requested ${toolCalls.length} tool call(s).`);
      toolCalls.forEach((call, idx) => {
        logDetail(`tool[${idx + 1}]: ${call.name}`);
      });

      for (const call of toolCalls) {
        const { name, call_id: callId } = call;
        let args = {};
        try {
          args = typeof call.input === 'string' ? JSON.parse(call.input) : call.input || {};
        } catch {
          args = {};
        }

        debugLog('tool-exec', { name, args });
        const handler = toolHandlers[name];
        let outcome;
        if (handler) {
          outcome = await handler(args);
        } else {
          const fallback = { ok: false, error: `Tool desconocida: ${name}` };
          outcome = {
            conversationResult: fallback,
            recordResult: fallback,
            extraMessages: [],
            continueLoop: false,
            exitLoop: false,
            note: '',
          };
        }

        const conversationResult = outcome.conversationResult ?? { ok: false };
        input.push(makeToolOutput(callId, conversationResult));
        if (outcome.recordResult) {
          iterationActions.push({ name, args, result: outcome.recordResult });
        }
        if (Array.isArray(outcome.extraMessages) && outcome.extraMessages.length > 0) {
          for (const msg of outcome.extraMessages) {
            input.push(msg);
          }
        }
        if (outcome.note) {
          iterationNote = outcome.note;
        }

        if (outcome.continueLoop) {
          await appendIterationInsight({ iteration, actions: iterationActions, note: iterationNote });
          previousResponseId = response.id;
          continue turnLoop;
        }

        if (outcome.exitLoop) {
          exitLoop = true;
          break;
        }
      }

      iterationNote = deriveIterationNote(agentState, iterationNote);
      await appendIterationInsight({ iteration, actions: iterationActions, note: iterationNote });

      previousResponseId = response.id;
      if (exitLoop) break;
    }

    try {
      debugLog('export-status', { exportSucceeded });
      await fsp.access(absOut);
    } catch {
      if (agentState.lastError) throw new Error(`No se generó el PDF de salida: ${agentState.lastError}`);
      throw new Error('No se generó el PDF de salida.');
    }

    if (!agentState.exportSucceeded) {
      throw new Error(agentState.lastError || 'export_resume_pdf no completó correctamente.');
    }

    const finalMessage = agentState.finalText || `PDF generated at ${absOut}`;
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
    for (const tempPath of tempFiles) {
      try {
        await fsp.unlink(tempPath);
      } catch (err) {
        debugLog('temp-delete-error', { tempPath, error: err?.message || err });
      }
    }
  }
}

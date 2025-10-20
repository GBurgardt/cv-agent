import OpenAI from "openai";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fillTemplateDocx } from "./tools/fillTemplateDocx.mjs";
import { generateIterationInsight } from "./tools/iterationInsight.mjs";
import { trimInputToBudget } from "./utils/tokenBudget.mjs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEBUG = process.env.CV_AGENT_DEBUG === "1";
// gpt-5-codex expone un contexto de ~200k tokens según documentación pública:
// https://github.com/openai/codex/issues/2002
const MODEL_CONTEXT_LIMIT = Number(process.env.MODEL_CONTEXT_LIMIT ?? 200000);
const CONTEXT_RESERVE_RATIO = Number(process.env.CONTEXT_RESERVE_RATIO ?? 0.6);

const SYSTEM_PROMPT = `
Sos "CV Builder DOCX". Objetivo: transformar un CV PDF en un DOCX final usando el template entregado.

Reglas:
- El PDF del CV ya está adjunto: leelo y usá su contenido para poblar los campos.
- Trabajá en español neutro, tono conciso y profesional, sin emojis.
- Debés armar:
  • SUMMARY: 4-6 líneas, orientado a reclutamiento.
  • SKILLS: string único con las principales habilidades separadas por comas (deduplicá por nombre).
  • LANGUAGES: array de objetos {language, level}.
  • KEY INDUSTRIES: array de strings con los sectores relevantes.
  • EDUCATION: array de objetos {institution, degree, period}.
  • EXPERIENCE: array cronológico de objetos {role, company, period, location, summary, bullets?}. Cada bullets es un array de strings.
  • NAME y ROLE si se infieren; en caso contrario, dejá strings vacíos.
- El template usa tags {SUMMARY}, {SKILLS}, {NAME}, {ROLE} y loops {#experience}, {#languages}, {#industries}, {#education}, {#bullets}. Respetá esos nombres exactos en el objeto fields.
- Si un dato no existe, dejalo en blanco ("") o como lista vacía según corresponda.
- Tratá cada mensaje que empiece con "Insight iteración" como instrucción prioritaria: cumplila antes de decidir el siguiente paso.

Flujo:
  1. Llamá fill_docx_template(template_path, output_docx_path, fields) con todos los campos completos. Podés repetir la llamada si necesitás corregir.
  2. Revisá la consistencia de los datos antes de finalizar.
  3. Cuando estés conforme, respondé indicando que el DOCX está generado, resume brevemente qué incluye y menciona la ruta resultante.
`;

function toolsDefinition() {
  return [
    {
      type: "function",
      name: "fill_docx_template",
      description:
        "Rellena el template DOCX con los campos solicitados y genera un nuevo archivo.",
      parameters: {
        type: "object",
        properties: {
          template_path: {
            type: "string",
            description: "Ruta del template DOCX con placeholders.",
          },
          output_docx_path: {
            type: "string",
            description: "Ruta donde guardar el DOCX resultante.",
          },
          fields: {
            type: "object",
            description:
              'Datos para inyectar. Ej: {"SUMMARY": "...", "SKILLS": "A, B", "experience": [...]}',
            additionalProperties: true,
          },
        },
        required: ["template_path", "output_docx_path", "fields"],
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
    if (
      block.type === "function_call" ||
      block.type === "tool_call" ||
      block.type === "custom_tool_call"
    ) {
      collected.push({
        call_id: block.call_id || block.id,
        name: block.name,
        input: block.arguments || block.input,
      });
      continue;
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item?.type === "tool_call" || item?.type === "custom_tool_call") {
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
    type: "function_call_output",
    call_id: callId,
    output: typeof output === "string" ? output : JSON.stringify(output),
  };
}

function toInputContent(text) {
  return text;
}

function createAgentState(initialDocxPath) {
  return {
    fills: 0,
    docxGenerated: false,
    docxPath: initialDocxPath,
    finalText: "",
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

function createToolHandlers(context) {
  const { logAction, logDetail, paths, state } = context;

  const executeFillDocx = async (args = {}) => {
    const templatePathArg = args?.template_path || paths.template;
    const outputDocxPath = args?.output_docx_path || paths.outputDocx;
    let result;

    logAction("Calling fill_docx_template");
    logDetail(`template_path: ${templatePathArg}`);
    logDetail(`output_docx_path: ${outputDocxPath}`);
    try {
      result = await fillTemplateDocx({
        templatePath: templatePathArg,
        outputDocxPath,
        fields: args?.fields || {},
      });
      state.docxGenerated = result?.ok !== false;
      state.docxPath = result?.docx_path || outputDocxPath;
      state.lastError = result?.error || null;
      if (state.docxGenerated) {
        state.finalText = `DOCX generated at ${state.docxPath}`;
      }
    } catch (err) {
      state.docxGenerated = false;
      state.lastError = err?.message || String(err);
      result = { ok: false, error: state.lastError };
      logDetail(`error: ${state.lastError}`);
    } finally {
      state.fills += 1;
    }

    return {
      conversationResult: result,
      recordResult: result,
      extraMessages: [],
      continueLoop: false,
      exitLoop: false,
      note: "",
    };
  };

  return {
    fill_docx_template: executeFillDocx,
  };
}

export async function runCvAgent({ cvPath, outPath, templatePath, model }) {
  const debugLog = (...args) => {
    if (DEBUG) console.log("[cv-agent:debug]", ...args);
  };
  const logAction = (msg) => console.log(`• ${msg}`);
  const logDetail = (msg) => console.log(`  └ ${msg}`);

  const absCv = path.resolve(cvPath);
  const absOut = path.resolve(outPath);
  const absTemplate = path.resolve(templatePath);

  debugLog("start", {
    cvPath: absCv,
    outPath: absOut,
    templatePath: absTemplate,
    modelOverride: model,
  });
  await fsp.access(absCv);
  await fsp.access(absTemplate);

  let uploadedFileId;

  try {
    logAction("Uploading source PDF…");
    const uploaded = await openai.files.create({
      file: fs.createReadStream(absCv),
      purpose: "user_data",
    });
    uploadedFileId = uploaded.id;
    logDetail(`file_id: ${uploadedFileId}`);

    const input = [
      { role: "system", content: toInputContent(SYSTEM_PROMPT) },
      {
        role: "system",
        content: toInputContent(
          `Paths sugeridos:\n- TEMPLATE_PATH: ${absTemplate}\n- OUTPUT_DOCX_PATH: ${absOut}\nUsá fill_docx_template para generar el archivo final.`
        ),
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Tenés el CV adjunto. Generá el DOCX usando el template y confirmá cuando quede listo.",
          },
          { type: "input_file", file_id: uploadedFileId },
        ],
      },
    ];

    const tools = toolsDefinition();
    const modelId = model || process.env.OPENAI_MODEL || "gpt-5-codex";

    let previousResponseId;
    let lastResponse = null;

    const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 128000);

    const agentState = createAgentState(absOut);
    const iterationHistory = [];
    const insightModelId = process.env.OPENAI_INSIGHT_MODEL || modelId;
    const paths = {
      template: absTemplate,
      outputDocx: absOut,
    };
    const toolHandlers = createToolHandlers({
      logAction,
      logDetail,
      paths,
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
        fills: agentState.fills,
        docxGenerated: agentState.docxGenerated,
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
            role: "system",
            content: toInputContent(
              `Insight iteración ${iteration}: ${insight}`
            ),
          });
        }
      } catch (err) {
        debugLog("insight-error", err?.message || err);
      }
    };

    turnLoop: for (let turn = 0; turn < 6; turn += 1) {
      const iteration = turn + 1;
      debugLog("turn", { turn: iteration });
      ensureContextBudget(input, logDetail);
      const response = await openai.responses.create({
        model: modelId,
        input,
        tools,
        tool_choice: "auto",
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: "medium", summary: "auto" },
        ...(previousResponseId
          ? { previous_response_id: previousResponseId }
          : {}),
      });

      debugLog("response", response);
      lastResponse = response;
      const toolCalls = extractToolCalls(response);
      debugLog("tool-calls", toolCalls);

      const iterationActions = [];
      let iterationNote = "";
      let exitLoop = false;

      if (!toolCalls.length) {
        logAction(`Iteration ${iteration}: no tool calls received.`);
        input.push({
          role: "system",
          content: toInputContent(
            "Recordá que debés llamar fill_docx_template para generar el DOCX con todos los campos."
          ),
        });
        iterationNote = "Sin tool calls; se envió recordatorio.";
        await appendIterationInsight({
          iteration,
          actions: iterationActions,
          note: iterationNote,
        });
        previousResponseId = response.id;
        continue;
      }

      logAction(
        `Iteration ${iteration}: model requested ${toolCalls.length} tool call(s).`
      );
      toolCalls.forEach((call, idx) => {
        logDetail(`tool[${idx + 1}]: ${call.name}`);
      });

      for (const call of toolCalls) {
        const { name, call_id: callId } = call;
        let args = {};
        try {
          args =
            typeof call.input === "string"
              ? JSON.parse(call.input)
              : call.input || {};
        } catch {
          args = {};
        }

        debugLog("tool-exec", { name, args });
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
            note: "",
          };
        }

        const conversationResult = outcome.conversationResult ?? { ok: false };
        input.push(makeToolOutput(callId, conversationResult));
        if (outcome.recordResult) {
          iterationActions.push({ name, args, result: outcome.recordResult });
        }
        if (
          Array.isArray(outcome.extraMessages) &&
          outcome.extraMessages.length > 0
        ) {
          for (const msg of outcome.extraMessages) {
            input.push(msg);
          }
        }
        if (outcome.note) {
          iterationNote = outcome.note;
        }

        if (outcome.continueLoop) {
          await appendIterationInsight({
            iteration,
            actions: iterationActions,
            note: iterationNote,
          });
          previousResponseId = response.id;
          continue turnLoop;
        }

        if (outcome.exitLoop) {
          exitLoop = true;
          break;
        }
      }

      iterationNote = deriveDocxIterationNote(agentState, iterationNote);
      await appendIterationInsight({
        iteration,
        actions: iterationActions,
        note: iterationNote,
      });

      previousResponseId = response.id;
      if (exitLoop) break;
      if (agentState.docxGenerated) break;
    }

    try {
      await fsp.access(absOut);
    } catch {
      if (agentState.lastError) {
        throw new Error(
          `No se generó el DOCX de salida: ${agentState.lastError}`
        );
      }
      throw new Error("No se generó el DOCX de salida.");
    }

    if (!agentState.docxGenerated) {
      throw new Error(
        agentState.lastError || "fill_docx_template no completó correctamente."
      );
    }

    const finalMessage = agentState.finalText || `DOCX generated at ${absOut}`;
    debugLog("final-message", finalMessage);
    logAction(`Done. DOCX generated at ${absOut}`);

    return {
      outputPath: absOut,
      raw: finalMessage,
      response: lastResponse,
    };
  } finally {
    if (uploadedFileId) {
      debugLog("file-delete", uploadedFileId);
      try {
        await openai.files.del(uploadedFileId);
      } catch (err) {
        debugLog("file-delete-error", err?.message || err);
      }
    }
  }
}
function deriveDocxIterationNote(state, currentNote) {
  if (currentNote) return currentNote;
  if (state.docxGenerated) {
    return "DOCX generado; confirmá en texto el resultado y la ruta final.";
  }
  if (state.fills === 0) {
    return "Falta llamar a fill_docx_template con todos los campos.";
  }
  return "";
}

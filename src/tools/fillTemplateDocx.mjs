import fsp from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import {
  BULLET_CHAR,
  hasText,
  toList,
  normalizeFields,
  buildExperienceEntries,
} from "../utils/docxFieldUtils.mjs";

export function addDerivedFields(fields = {}) {
  // Clone the structure so the caller's object always stays untouched.
  const draft = { ...fields };

  // If the model already sent LANGUAGES_LINES, leave it exactly as-is.
  const hasLanguagesLines =
    typeof draft.LANGUAGES_LINES === "string" && draft.LANGUAGES_LINES.trim();
  const languageSource =
    fields?.LANGUAGES ??
    fields?.languages ??
    fields?.Languages ??
    fields?.language ??
    fields?.langs;

  if (!hasLanguagesLines && languageSource) {
    const languages = toList(languageSource)
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!entry || typeof entry !== "object") return "";
        const name =
          [entry.language, entry.name, entry.label, entry.text].find((value) =>
            hasText(value)
          ) || "";
        const level =
          [
            entry.level,
            entry.proficiency,
            entry.fluency,
            entry.description,
          ].find((value) => hasText(value)) || "";
        if (!hasText(name)) return "";
        const label = name.trim();
        return hasText(level)
          ? `${label} (${level.trim()})`
          : label;
      })
      .map((line) => line.trim())
      .filter((line) => hasText(line))
      .filter((line, idx, arr) => arr.indexOf(line) === idx)
      .map((line) =>
        line.startsWith(BULLET_CHAR) ? line : `${BULLET_CHAR} ${line}`
      );

    if (languages.length > 0) {
      draft.LANGUAGES_LINES = languages.join("\n");
    }
  }

  // Same approach for INDUSTRIES_LINES: trust the model first, backfill only if needed.
  const hasIndustriesLines =
    typeof draft.INDUSTRIES_LINES === "string" &&
    draft.INDUSTRIES_LINES.trim();
  const industriesSource =
    fields?.INDUSTRIES ??
    fields?.industries ??
    fields?.Industries ??
    fields?.sectors ??
    fields?.industry;

  if (!hasIndustriesLines && industriesSource) {
    const industries = toList(industriesSource)
      .flatMap((item) =>
        typeof item === "string" ? item.split(/[\r\n]+/) : [item]
      )
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        const label =
          [item.name, item.label, item.text, item.value].find((value) =>
            hasText(value)
          ) || "";
        return label.trim();
      })
      .map((line) => line.trim())
      .filter((line) => hasText(line))
      .filter((line, idx, arr) => arr.indexOf(line) === idx)
      .map((line) =>
        line.startsWith(BULLET_CHAR) ? line : `${BULLET_CHAR} ${line}`
      );

    if (industries.length > 0) {
      draft.INDUSTRIES_LINES = industries.join("\n");
    }
  }

  if (!hasText(draft.LANGUAGES_LINES)) {
    draft.LANGUAGES_LINES = "";
  }
  if (!hasText(draft.INDUSTRIES_LINES)) {
    draft.INDUSTRIES_LINES = "";
  }

  const experienceEntries = buildExperienceEntries(
    draft.EXPERIENCE ?? fields.EXPERIENCE ?? []
  );
  draft.EXPERIENCE = experienceEntries;
  draft.EXPERIENCE_LINES = experienceEntries
    .map((exp) => {
      const header = [exp.company, exp.role].filter(hasText).join(" — ");
      const meta = [exp.period, exp.location].filter(hasText).join(" | ");
      const parts = [];
      if (hasText(header)) parts.push(header);
      if (hasText(meta)) parts.push(meta);
      if (hasText(exp.summary)) parts.push(exp.summary);
      if (Array.isArray(exp.bullets) && exp.bullets.length) {
        parts.push(exp.bullets.map((b) => `${BULLET_CHAR} ${b}`).join("\n"));
      }
      if (hasText(exp.tech)) parts.push(`Tech: ${exp.tech}`);
      return parts.join("\n");
    })
    .filter(hasText)
    .join("\n\n");

  return draft;
}

export async function fillTemplateDocx({
  templatePath,
  outputDocxPath,
  fields = {},
}) {
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
    throw new Error(
      "fill_docx_template requires a non-empty 'fields' object; received empty payload."
    );
  }

  // Resolve locations once so docxtemplater reads/writes from deterministic paths.
  const absTemplate = path.resolve(templatePath);
  const absDocx = path.resolve(outputDocxPath);

  // Load the DOCX template for docxtemplater to manipulate.
  const templateBuffer = await fsp.readFile(absTemplate);
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  try {
    // Allow the model to drive the content; we only backfill missing bullet strings.
    const enriched = addDerivedFields(fields);
    const data = normalizeFields(enriched);
    if (process.env.CV_AGENT_DEBUG === "1") {
      console.log("[fillTemplateDocx] fields input:", fields);
      console.log("[fillTemplateDocx] fields derived:", enriched);
      console.log("[fillTemplateDocx] fields normalized:", data);
    }
    doc.render(data);
  } catch (err) {
    const details =
      err?.properties?.errors?.map((e) => e?.message).join("; ") || err?.message;
    throw new Error(`Error al renderizar DOCX: ${details || "desconocido"}`);
  }

  // Persist the rendered DOCX on disk and bubble the resulting path.
  const buffer = doc.getZip().generate({ type: "nodebuffer" });
  await fsp.mkdir(path.dirname(absDocx), { recursive: true });
  await fsp.writeFile(absDocx, buffer);

  return { ok: true, docx_path: absDocx };
}

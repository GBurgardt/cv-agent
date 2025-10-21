import fsp from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

const BULLET_CHAR = "•";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const normalized = value
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized;
  }
  if (!value) return [];
  return [value];
}

function isEmptyObject(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.values(obj).every((value) => {
      if (Array.isArray(value)) {
        return value.length === 0;
      }
      if (value && typeof value === "object") {
        return isEmptyObject(value);
      }
      return value === "";
    })
  );
}

function normalizeValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizeValue(item))
      .filter((item) => {
        if (item == null) return false;
        if (Array.isArray(item)) return item.length > 0;
        if (typeof item === "object") return !isEmptyObject(item);
        if (typeof item === "string") return item.trim().length > 0;
        return true;
      });
    return normalizedItems;
  }
  if (typeof value === "object") {
    return normalizeFields(value);
  }
  return String(value);
}

function normalizeFields(fields = {}) {
  if (!fields || typeof fields !== "object") return {};
  const normalized = {};
  for (const [key, rawValue] of Object.entries(fields)) {
    if (Array.isArray(rawValue) && key === "experience") {
      const experiences = rawValue
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const working = { ...entry };
          if (!Array.isArray(working.bullets) && Array.isArray(working.highlights)) {
            working.bullets = working.highlights;
          }
          if (working.highlights) {
            delete working.highlights;
          }
          if (!Array.isArray(working.bullets)) {
            working.bullets = [];
          }
          const normalizedEntry = normalizeFields(working);
          return isEmptyObject(normalizedEntry) ? null : normalizedEntry;
        })
        .filter(Boolean);
      normalized[key] = experiences;
      continue;
    }

    if (Array.isArray(rawValue) && (key === "bullets" || key === "highlights")) {
      const bullets = rawValue
        .map((item) => {
          if (!item) return null;
          if (typeof item === "string") return item.trim();
          if (typeof item === "object") {
            const text =
              typeof item.text === "string"
                ? item.text
                : typeof item.description === "string"
                ? item.description
                : typeof item.value === "string"
                ? item.value
                : "";
            return text.trim();
          }
          return String(item).trim();
        })
        .filter((text) => text && text.length > 0)
        .map((text) => ({ text }));
      normalized[key] = bullets;
      continue;
    }

    normalized[key] = normalizeValue(rawValue);
  }
  return normalized;
}

function addDerivedFields(fields = {}) {
  const draft = { ...fields };
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

  return draft;
}

export async function fillTemplateDocx({
  templatePath,
  outputDocxPath,
  fields = {},
}) {
  const absTemplate = path.resolve(templatePath);
  const absDocx = path.resolve(outputDocxPath);

  const templateBuffer = await fsp.readFile(absTemplate);
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  try {
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

  const buffer = doc.getZip().generate({ type: "nodebuffer" });
  await fsp.mkdir(path.dirname(absDocx), { recursive: true });
  await fsp.writeFile(absDocx, buffer);

  return { ok: true, docx_path: absDocx };
}

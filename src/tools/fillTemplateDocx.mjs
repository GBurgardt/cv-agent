import fsp from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

const BULLET_CHAR = "•";

const LANGUAGE_LEVEL_MAP = {
  native: "native",
  "native or bilingual": "native",
  "bilingual": "native",
  "nativo": "native",
  "nativo o bilingue": "native",
  fluent: "fluent",
  "fluido": "fluent",
  "advanced": "advanced",
  "avanzado": "advanced",
  "upper intermediate": "advanced",
  "profesional": "intermediate",
  "professional": "intermediate",
  "professional working proficiency": "intermediate",
  "intermedio": "intermediate",
  "intermediate": "intermediate",
  "elemental": "basic",
  "basico": "basic",
  "básico": "basic",
  basic: "basic",
  beginner: "basic",
};

const IGNORED_TEXT_VALUES = new Set(["undefined", "null", "n/a", "na", "-"]);

function normalizeKey(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mapLanguageLevel(raw) {
  if (!raw) return "";
  const key = normalizeKey(String(raw));
  return LANGUAGE_LEVEL_MAP[key] || String(raw).trim().toLowerCase();
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
  const languageSource =
    fields?.LANGUAGES ??
    fields?.languages ??
    fields?.Languages ??
    fields?.language ??
    fields?.langs;

  if (languageSource) {
    const languages = toList(languageSource)
      .map((entry) => {
        if (!entry) return "";
        if (typeof entry === "string") {
          const trimmed = entry.trim();
          if (!trimmed) return "";
          return trimmed.includes("(") ? trimmed : `${trimmed}`;
        }
        const language =
          (typeof entry.language === "string" && entry.language.trim()) ||
          (typeof entry.name === "string" && entry.name.trim()) ||
          (typeof entry.label === "string" && entry.label.trim()) ||
          (typeof entry.text === "string" && entry.text.trim()) ||
          "";
        const levelRaw =
          (typeof entry.level === "string" && entry.level.trim()) ||
          (typeof entry.proficiency === "string" && entry.proficiency.trim()) ||
          (typeof entry.fluency === "string" && entry.fluency.trim()) ||
          (typeof entry.description === "string" && entry.description.trim()) ||
          "";
        const levelMapped = mapLanguageLevel(levelRaw);
        const label = language || "";
        if (!label) return "";
        if (!levelMapped) return label;
        return `${label}(${levelMapped})`;
      })
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        const key = normalizeKey(line);
        return !IGNORED_TEXT_VALUES.has(key);
      })
      .filter((line, idx, arr) => arr.indexOf(line) === idx)
      .map((line) => `${BULLET_CHAR} ${line}`);

    draft.LANGUAGES_LINES = languages.join("\n");
  }

  const industriesSource =
    fields?.INDUSTRIES ??
    fields?.industries ??
    fields?.Industries ??
    fields?.sectors ??
    fields?.industry;

  if (industriesSource) {
    const industries = toList(industriesSource)
      .flatMap((item) =>
        typeof item === "string" ? item.split(/[\r\n]+/) : [item]
      )
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item.trim();
        if (typeof item === "object") {
          const label =
            (typeof item.name === "string" && item.name.trim()) ||
            (typeof item.label === "string" && item.label.trim()) ||
            (typeof item.text === "string" && item.text.trim()) ||
            "";
          return label;
        }
        return String(item).trim();
      })
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        const key = normalizeKey(line);
        return !IGNORED_TEXT_VALUES.has(key);
      })
      .filter((line, idx, arr) => arr.indexOf(line) === idx)
      .map((line) => `${BULLET_CHAR} ${line}`);

    draft.INDUSTRIES_LINES = industries.join("\n");
  }

  if (!draft.LANGUAGES_LINES) {
    draft.LANGUAGES_LINES = "";
  }
  if (!draft.INDUSTRIES_LINES) {
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

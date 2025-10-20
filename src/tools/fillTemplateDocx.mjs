import fsp from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

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
    const data = normalizeFields(fields);
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

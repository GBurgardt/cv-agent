import fsp from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

function normalizeFields(fields = {}) {
  // Ensure we always pass plain objects/arrays/strings to docxtemplater.
  if (!fields || typeof fields !== "object") return {};
  const normalized = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) {
      normalized[key] = "";
    } else if (Array.isArray(value)) {
      normalized[key] = value;
    } else if (typeof value === "object") {
      normalized[key] = normalizeFields(value);
    } else {
      normalized[key] = value;
    }
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

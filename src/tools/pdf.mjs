import fs from 'fs/promises';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export async function readPdfText(pdfPath) {
  try {
    const buffer = await fs.readFile(pdfPath);
    const parsed = await pdfParse(buffer);
    const text = (parsed?.text || '').trim();
    if (!text) {
      return { ok: false, error: 'PDF sin texto extraíble (¿escaneado o vacío?).' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: `No pude leer PDF: ${err.message}` };
  }
}

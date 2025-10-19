import fsp from 'fs/promises';
import path from 'path';

export async function exportResumeDoc({ htmlPath, outputDocPath }) {
  const absHtml = path.resolve(htmlPath);
  const absDoc = path.resolve(outputDocPath);

  const htmlContent = await fsp.readFile(absHtml, 'utf8');
  await fsp.mkdir(path.dirname(absDoc), { recursive: true });

  // Guardamos el HTML tal cual con extensión .doc; Word y Google Docs lo abren como documento editable.
  await fsp.writeFile(absDoc, htmlContent, 'utf8');

  return { ok: true, doc_path: absDoc };
}

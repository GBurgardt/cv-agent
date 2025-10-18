import fsp from 'fs/promises';
import path from 'path';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function skillsToHtml(skills) {
  const list = Array.isArray(skills) ? skills : [];
  if (!list.length) return '<ul></ul>';
  const items = list.map((skill) => `<li>${escapeHtml(skill)}</li>`).join('');
  return `<ul>${items}</ul>`;
}

function applyPlaceholders(html, fields = {}) {
  const replacements = {
    __SUMMARY__: escapeHtml(fields.SUMMARY || ''),
    __SKILLS__: skillsToHtml(fields.SKILLS || []),
    __NAME__: escapeHtml(fields.NAME || ''),
    __ROLE__: escapeHtml(fields.ROLE || ''),
  };

  let rendered = html;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.split(key).join(value);
  }
  return rendered;
}

export async function fillTemplateHtml({ templatePath, outputHtmlPath, fields }) {
  const absTemplate = path.resolve(templatePath);
  const absHtml = path.resolve(outputHtmlPath);

  const templateHtml = await fsp.readFile(absTemplate, 'utf8');
  const filledHtml = applyPlaceholders(templateHtml, fields || {});

  await fsp.mkdir(path.dirname(absHtml), { recursive: true });
  await fsp.writeFile(absHtml, filledHtml, 'utf8');

  return { ok: true, html_path: absHtml };
}

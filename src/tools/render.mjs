import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

const DEBUG = process.env.CV_AGENT_DEBUG === '1';
const debugLog = (...args) => {
  if (DEBUG) console.log('[render_template_pdf:debug]', ...args);
};

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

export async function renderTemplateToPdf({ templatePath, outputPath, fields }) {
  try {
    const absTemplate = path.resolve(templatePath);
    const absOut = path.resolve(outputPath);

    debugLog('inputs', { template: absTemplate, output: absOut, fields });

    await fs.mkdir(path.dirname(absOut), { recursive: true });

    const templateHtml = await fs.readFile(absTemplate, 'utf8');
    debugLog('template-length', templateHtml.length);
    const filledHtml = applyPlaceholders(templateHtml, fields);

    debugLog('filled-length', filledHtml.length);

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setContent(filledHtml, { waitUntil: 'load' });
    await page.emulateMediaType('print');
    await page.pdf({
      path: absOut,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    await browser.close();

    debugLog('pdf-generated', absOut);

    return { ok: true, output_path: absOut };
  } catch (err) {
    console.error('[render_template_pdf] Error:', err);
    return { ok: false, error: `Render falló: ${err.message}` };
  }
}

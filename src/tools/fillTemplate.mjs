import fsp from 'fs/promises';
import path from 'path';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function summaryToHtml(value) {
  if (!value) return '';
  const parts = Array.isArray(value) ? value : String(value).split(/\n{2,}/);
  const segments = parts
    .map((part) => part && String(part).trim())
    .filter(Boolean)
    .map((part) => {
      const lines = part.split(/\n+/).map((line) => escapeHtml(line));
      return `<p>${lines.join('<br />')}</p>`;
    });
  return segments.join('');
}

function normalizeListSource(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (/<li[\s>]/i.test(trimmed)) return trimmed;
    return trimmed
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [value];
}

function formatListItems(items, formatter) {
  const source = normalizeListSource(items);
  if (typeof source === 'string') {
    return source;
  }
  if (!Array.isArray(source) || source.length === 0) return '';
  const html = source
    .map((item) => formatter(item))
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join('');
  return html;
}

function skillsToInline(skills) {
  const source = normalizeListSource(skills);
  if (typeof source === 'string') {
    return escapeHtml(source.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim());
  }
  if (!Array.isArray(source) || source.length === 0) return '';
  const labels = source
    .map((skill) => {
      if (!skill && skill !== 0) return '';
      if (typeof skill === 'string') return skill;
      return skill?.name || skill?.label || '';
    })
    .map((label) => (label ? label.trim() : ''))
    .filter(Boolean);
  if (!labels.length) return '';
  return labels.map((label) => escapeHtml(label)).join(', ');
}

function languagesToHtml(languages) {
  return formatListItems(languages, (language) => {
    if (!language && language !== 0) return '';
    if (typeof language === 'string') {
      return `<li>${escapeHtml(language)}</li>`;
    }
    const name = language?.language || language?.name || '';
    const level = language?.level || language?.proficiency || '';
    if (!name && !level) return '';
    const rendered = level ? `${name} — ${level}` : name;
    return `<li>${escapeHtml(rendered)}</li>`;
  });
}

function industriesToHtml(industries) {
  return formatListItems(industries, (industry) => {
    if (!industry && industry !== 0) return '';
    const label = typeof industry === 'string' ? industry : industry?.name || '';
    if (!label) return '';
    return `<li>${escapeHtml(label)}</li>`;
  });
}

function educationToHtml(education) {
  return formatListItems(education, (entry) => {
    if (!entry && entry !== 0) return '';
    if (typeof entry === 'string') {
      return `<li>${escapeHtml(entry)}</li>`;
    }
    const institution = entry?.institution || entry?.school || entry?.university || '';
    const degree = entry?.degree || entry?.title || entry?.program || '';
    const period = entry?.period || entry?.dates || entry?.year || '';
    if (!institution && !degree && !period) return '';
    const pieces = [];
    if (institution) pieces.push(`<strong>${escapeHtml(institution)}</strong>`);
    if (degree) pieces.push(escapeHtml(degree));
    const description = pieces.join(' — ');
    const suffix = period ? ` <span>${escapeHtml(period)}</span>` : '';
    return `<li>${description}${suffix}</li>`;
  });
}

function bulletsToHtml(list) {
  return formatListItems(list, (item) => {
    if (!item && item !== 0) return '';
    const text = typeof item === 'string' ? item : item?.text || '';
    if (!text) return '';
    return `<li>${escapeHtml(text)}</li>`;
  });
}

function experienceToHtml(experiences) {
  if (!experiences) return '';
  if (typeof experiences === 'string') {
    return experiences;
  }
  if (!Array.isArray(experiences) || experiences.length === 0) return '';

  return experiences
    .map((exp) => {
      if (!exp) return '';
      if (typeof exp === 'string') {
        return `<div class="experience-item"><div class="experience-details">${escapeHtml(exp)}</div></div>`;
      }

      const role = exp?.role || exp?.title || '';
      const company = exp?.company || exp?.employer || '';
      const location = exp?.location || '';
      const period = exp?.period || exp?.dates || '';
      const summary = exp?.summary || exp?.description || '';
      const bullets = bulletsToHtml(exp?.highlights || exp?.bullets || []);
      const tech = exp?.tech || exp?.stack || exp?.technologies || '';

      const headingParts = [role, company].filter(Boolean).map((part) => escapeHtml(part));
      const heading = headingParts.join(' · ');
      const metaParts = [period, location].filter(Boolean).map((part) => escapeHtml(part));
      const meta = metaParts.join(' • ');

      const detailPieces = [];
      if (summary) {
        detailPieces.push(`<p>${escapeHtml(summary)}</p>`);
      }
      if (bullets) {
        detailPieces.push(`<ul>${bullets}</ul>`);
      }
      if (tech) {
        detailPieces.push(`<p><strong>Tech:</strong> ${escapeHtml(tech)}</p>`);
      }

      const details = detailPieces.join('');

      return `
        <div class="experience-item">
          ${heading ? `<h3>${heading}</h3>` : ''}
          ${meta ? `<div class="experience-meta">${meta}</div>` : ''}
          ${details ? `<div class="experience-details">${details}</div>` : ''}
        </div>
      `;
    })
    .map((section) => section.trim())
    .filter(Boolean)
    .join('');
}

function applyPlaceholders(html, fields = {}) {
  const replacements = {
    __SUMMARY__: summaryToHtml(fields.SUMMARY || ''),
    __SKILLS__: skillsToInline(fields.SKILLS || []),
    __NAME__: escapeHtml(fields.NAME || ''),
    __ROLE__: escapeHtml(fields.ROLE || ''),
    __LANGUAGES__: languagesToHtml(fields.LANGUAGES || []),
    __INDUSTRIES__: industriesToHtml(fields.INDUSTRIES || []),
    __EDUCATION__: educationToHtml(fields.EDUCATION || []),
    __EXPERIENCE__: experienceToHtml(fields.EXPERIENCE || []),
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

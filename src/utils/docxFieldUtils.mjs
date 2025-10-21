export const BULLET_CHAR = "•";

export function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (value == null) return [];
  return [value];
}

export function isEmptyObject(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.values(obj).every((value) => {
      if (Array.isArray(value)) return value.length === 0;
      if (value && typeof value === "object") return isEmptyObject(value);
      return value === "";
    })
  );
}

export function normalizeValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .filter((item) => {
        if (item == null) return false;
        if (Array.isArray(item)) return item.length > 0;
        if (typeof item === "object") return !isEmptyObject(item);
        if (typeof item === "string") return item.trim().length > 0;
        return true;
      });
  }
  if (typeof value === "object") {
    return normalizeFields(value);
  }
  return String(value);
}

export function normalizeFields(fields = {}) {
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
          if (working.highlights) delete working.highlights;
          if (!Array.isArray(working.bullets)) working.bullets = [];
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

export function buildExperienceLines(experiences) {
  const entries = toList(experiences)
    .map((entry) => {
      if (!entry) return "";
      if (typeof entry === "string") return entry.trim();
      if (typeof entry !== "object") return "";

      const role = hasText(entry.role) ? entry.role.trim() : "";
      const company = hasText(entry.company) ? entry.company.trim() : "";
      const headerParts = [];
      if (company) headerParts.push(company);
      if (role) headerParts.push(role);
      const header = headerParts.length
        ? `**${headerParts.join(" — ")}**`
        : "";

      const period = hasText(entry.period) ? entry.period.trim() : "";
      const location = hasText(entry.location) ? entry.location.trim() : "";
      const metaParts = [];
      if (period) metaParts.push(period);
      if (location) metaParts.push(location);
      const meta = metaParts.length ? metaParts.join(" | ") : "";

      const summary = hasText(entry.summary) ? entry.summary.trim() : "";

      const bullets = Array.isArray(entry.bullets)
        ? entry.bullets
            .map((bullet) =>
              hasText(bullet)
                ? bullet.trim().startsWith(BULLET_CHAR)
                  ? bullet.trim()
                  : `${BULLET_CHAR} ${bullet.trim()}`
                : ""
            )
            .filter(hasText)
        : [];

      const techRaw =
        entry.tech ||
        entry.stack ||
        entry.technologies ||
        entry.tools ||
        entry.language;
      const tech = hasText(techRaw) ? `Tech: ${techRaw.trim()}` : "";

      const lines = [];
      if (header) lines.push(header);
      if (meta) lines.push(meta);
      if (summary) lines.push(summary);
      if (bullets.length) lines.push(bullets.join("\n"));
      if (tech) lines.push(tech);

      return lines.filter(hasText).join("\n");
    })
    .filter(hasText);

  return entries.join("\n\n");
}

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
    if (Array.isArray(rawValue) && (key === "bullets" || key === "highlights")) {
      const bullets = rawValue
        .map((item) => {
          if (!item) return null;
          if (typeof item === "object" && (hasText(item.value) || hasText(item["."]))) {
            const text = hasText(item.value) ? item.value.trim() : item["."].trim();
            return { value: text, ".": text };
          }
          if (typeof item === "string") {
            const text = item.trim();
            return text ? { value: text, ".": text } : null;
          }
          return null;
        })
        .filter(Boolean);
      normalized[key] = bullets;
      continue;
    }

    normalized[key] = normalizeValue(rawValue);
  }
  return normalized;
}

export function buildExperienceEntries(experiences) {
  return toList(experiences)
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string") {
        const value = entry.trim();
        return value
          ? {
              company: "",
              role: value,
              period: "",
              location: "",
              summary: value,
              bullets: [],
              tech: "",
              bullets_lines: "",
            }
          : null;
      }
      if (typeof entry !== "object") return null;

      const company = hasText(entry.company)
        ? entry.company.trim()
        : hasText(entry.employer)
        ? entry.employer.trim()
        : hasText(entry.organization)
        ? entry.organization.trim()
        : "";

      const role = hasText(entry.role)
        ? entry.role.trim()
        : hasText(entry.title)
        ? entry.title.trim()
        : "";

      const period = hasText(entry.period)
        ? entry.period.trim()
        : hasText(entry.dates)
        ? entry.dates.trim()
        : hasText(entry.date)
        ? entry.date.trim()
        : "";

      const location = hasText(entry.location)
        ? entry.location.trim()
        : hasText(entry.city)
        ? entry.city.trim()
        : "";

      const summary = hasText(entry.summary)
        ? entry.summary.trim()
        : hasText(entry.description)
        ? entry.description.trim()
        : "";

      const bulletStrings = Array.isArray(entry.bullets)
        ? entry.bullets.filter(hasText).map((b) => b.trim())
        : Array.isArray(entry.highlights)
        ? entry.highlights.filter(hasText).map((b) => b.trim())
        : [];
      const bullets = bulletStrings.map((text) => ({ value: text, ".": text }));

      const bulletsLines = bulletStrings.length
        ? bulletStrings.map((text) => `${BULLET_CHAR} ${text}`).join("\n")
        : "";

      const techSource =
        entry.tech ||
        entry.stack ||
        entry.technologies ||
        entry.tools ||
        entry.language ||
        "";
      const tech = hasText(techSource) ? techSource.trim() : "";

      if (
        !hasText(company) &&
        !hasText(role) &&
        !hasText(period) &&
        !hasText(location) &&
        !hasText(summary) &&
        !bullets.length &&
        !hasText(tech)
      ) {
        return null;
      }

      return {
        company,
        role,
        period,
        location,
        summary,
        bullets,
        bullets_lines: bulletsLines,
        tech,
      };
    })
    .filter(Boolean);
}

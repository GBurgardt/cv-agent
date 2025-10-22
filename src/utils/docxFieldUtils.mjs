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
        .filter((text) => text && text.length > 0);
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

      const bullets = Array.isArray(entry.bullets)
        ? entry.bullets.filter(hasText).map((b) => b.trim())
        : Array.isArray(entry.highlights)
        ? entry.highlights.filter(hasText).map((b) => b.trim())
        : [];

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
        tech,
      };
    })
    .filter(Boolean);
}

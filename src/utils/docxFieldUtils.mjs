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

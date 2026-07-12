const PUBLIC_EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function dataCorrectionsEmail(value = process.env.DATA_CORRECTIONS_EMAIL): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const localPart = candidate.slice(0, candidate.indexOf("@"));
  if (candidate.length > 254 || localPart.length > 64 || localPart.startsWith(".")
    || localPart.endsWith(".") || localPart.includes("..") || !PUBLIC_EMAIL_PATTERN.test(candidate)) {
    throw new Error("DATA_CORRECTIONS_EMAIL must be a valid public email address");
  }
  return candidate;
}

export function validateContactEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("contactEmail must be a valid email address");
  const candidate = value.trim();
  const localPart = candidate.slice(0, candidate.indexOf("@"));
  if (candidate.length > 254 || localPart.length > 64 || localPart.startsWith(".")
    || localPart.endsWith(".") || localPart.includes("..") || !PUBLIC_EMAIL_PATTERN.test(candidate)) {
    throw new Error("contactEmail must be a valid email address");
  }
  return candidate;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;
const LONG_DIGIT_PATTERN = /\b\d{4,}\b/g;

export function redactDtmfDigits(digits: string | null | undefined): string {
  if (!digits) return "";
  return digits.replace(/\d/g, "*").slice(0, 64);
}

export function redactPii(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, (match) => `[redacted-phone:${match.replace(/\D/g, "").length}]`)
    .replace(LONG_DIGIT_PATTERN, (match) => `[redacted-digits:${match.length}]`)
    .slice(0, 10_000);
}

export function redactVoiceMetadata(metadata: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, redactPii(value ?? "")]),
  );
}

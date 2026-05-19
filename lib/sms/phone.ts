export function normalizeSmsPhoneNumber(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const stripped = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(stripped)) return stripped;

  if (/^00\d{8,15}$/.test(stripped)) {
    return `+${stripped.slice(2)}`;
  }

  // Most seeded Collie tenants are AU-based. Convert common AU mobile formats,
  // but avoid guessing for other local numbers.
  const digits = stripped.replace(/\D/g, "");
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  if (/^614\d{8}$/.test(digits)) return `+${digits}`;

  return null;
}

export function normalizeSmsSender(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const phone = normalizeSmsPhoneNumber(raw);
  if (phone) return phone;

  // Twilio supports alphanumeric sender IDs in countries including AU. Keep the
  // check strict so arbitrary strings do not get sent as From values.
  if (/^[A-Za-z0-9 ]{1,11}$/.test(raw)) return raw;

  return null;
}

export function firstSmsKeyword(body: string | null | undefined): string {
  return (body ?? "").trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
}

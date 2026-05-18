type BrandInput = {
  name?: string | null;
  brand?: string | null;
  fromName?: string | null;
  brandColour?: string | null;
  logoDomain?: string | null;
};

const demoBrandColours: Array<[RegExp, string]> = [
  [/docusign/i, "#4c00ff"],
  [/parcel|delivery|courier/i, "#0d1b2a"],
  [/workspace|account|password/i, "#2563eb"],
  [/finance|invoice|payment/i, "#13b5ea"],
  [/sign|document|signature/i, "#4c00ff"],
  [/mobile|telecom|bill/i, "#005eb8"],
  [/people|benefits|training/i, "#4f6f52"],
  [/executive|office/i, "#0d1b2a"],
  [/printer|scan/i, "#475569"],
];

const verifiedBrandDomains: Array<[RegExp, string]> = [
  [/docusign/i, "docusign.com"],
];

function cleanBrandName(value: string) {
  return value
    .replaceAll("{{organisationName}}", "Your organisation")
    .replace(/\s+/g, " ")
    .trim();
}

function brandInitial(value: string) {
  const letters = cleanBrandName(value)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return letters || "C";
}

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

export function inferBrandProfile(input: BrandInput) {
  const label = `${input.name ?? ""} ${input.brand ?? ""} ${input.fromName ?? ""}`.trim();
  const displayName = cleanBrandName(input.brand || input.fromName || input.name || "Secure message");
  const colour = input.brandColour || demoBrandColours.find(([pattern]) => pattern.test(label))?.[1] || "#0d1b2a";
  const domain = input.logoDomain?.trim() || verifiedBrandDomains.find(([pattern]) => pattern.test(label))?.[1] || null;

  return {
    displayName,
    initial: brandInitial(displayName),
    colour,
    domain,
    logoUrl: domain ? faviconUrl(domain) : "",
  };
}

export function emailLogoMarkup(input: BrandInput) {
  const brand = inferBrandProfile(input);

  if (!brand.logoUrl) {
    return `<span style="display:inline-flex;width:38px;height:38px;border-radius:8px;background:${brand.colour};color:#ffffff;align-items:center;justify-content:center;font-size:14px;font-weight:700;">${brand.initial}</span>`;
  }

  return `<img src="${brand.logoUrl}" width="38" height="38" alt="${brand.displayName}" style="display:block;width:38px;height:38px;border:1px solid rgba(100,116,139,.22);border-radius:8px;background:#ffffff;object-fit:contain;" />`;
}

export function landingLogoMarkup(input: BrandInput) {
  const brand = inferBrandProfile(input);

  if (!brand.logoUrl) {
    return `<div class="brand-mark">${brand.initial}</div>`;
  }

  return `<img class="brand-logo" src="${brand.logoUrl}" alt="${brand.displayName}" />`;
}

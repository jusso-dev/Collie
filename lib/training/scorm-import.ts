import { inflateRawSync } from "node:zlib";

export type ImportedScormModule = {
  title: string;
  description: string;
  durationSeconds: number;
  topic: string;
  contentHtml: string;
};

type ZipEntry = {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const decoder = new TextDecoder();
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_HTML_BYTES = 2_000_000;

function readUInt16(data: Uint8Array, offset: number) {
  return data[offset] | (data[offset + 1] << 8);
}

function readUInt32(data: Uint8Array, offset: number) {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

function findEndOfCentralDirectory(data: Uint8Array) {
  const minOffset = Math.max(0, data.length - 0xffff - 22);
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(data, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function normaliseZipPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseEntries(data: Uint8Array) {
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new Error("SCORM package is not a valid ZIP file.");

  const entryCount = readUInt16(data, eocd + 10);
  const centralDirectoryOffset = readUInt32(data, eocd + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(data, offset) !== 0x02014b50) {
      throw new Error("SCORM package central directory is invalid.");
    }

    const compressionMethod = readUInt16(data, offset + 10);
    const compressedSize = readUInt32(data, offset + 20);
    const uncompressedSize = readUInt32(data, offset + 24);
    const nameLength = readUInt16(data, offset + 28);
    const extraLength = readUInt16(data, offset + 30);
    const commentLength = readUInt16(data, offset + 32);
    const localHeaderOffset = readUInt32(data, offset + 42);
    const path = normaliseZipPath(decoder.decode(data.slice(offset + 46, offset + 46 + nameLength)));

    if (path && !path.includes("..") && !path.endsWith("/")) {
      entries.push({ path, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(data: Uint8Array, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (readUInt32(data, offset) !== 0x04034b50) {
    throw new Error(`SCORM package has an invalid local header for ${entry.path}.`);
  }

  const nameLength = readUInt16(data, offset + 26);
  const extraLength = readUInt16(data, offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = data.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) {
    const inflated = inflateRawSync(compressed);
    if (entry.uncompressedSize > 0 && inflated.length !== entry.uncompressedSize) {
      throw new Error(`SCORM package file size mismatch for ${entry.path}.`);
    }
    return inflated;
  }

  throw new Error(`SCORM package uses unsupported ZIP compression method ${entry.compressionMethod}.`);
}

function textContent(xml: string, tag: string) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrValue(markup: string, attr: string) {
  const match = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(markup);
  return match?.[1]?.trim() ?? null;
}

function htmlTitle(html: string) {
  return textContent(html, "title") || textContent(html, "h1");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function extractScormPackage(input: ArrayBuffer): ImportedScormModule {
  const data = new Uint8Array(input);
  const entries = parseEntries(data);
  const entryByLowerPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]));
  const manifestEntry = entryByLowerPath.get("imsmanifest.xml") ?? entries.find((entry) => entry.path.toLowerCase().endsWith("/imsmanifest.xml"));

  if (!manifestEntry) {
    throw new Error("SCORM package is missing imsmanifest.xml.");
  }
  if (manifestEntry.uncompressedSize > MAX_MANIFEST_BYTES) {
    throw new Error("SCORM manifest is too large to import.");
  }

  const manifest = decoder.decode(readEntry(data, manifestEntry));
  const firstResource = /<resource\b[\s\S]*?>/i.exec(manifest)?.[0] ?? "";
  const launchHref = attrValue(firstResource, "href");
  const manifestBase = manifestEntry.path.includes("/")
    ? manifestEntry.path.slice(0, manifestEntry.path.lastIndexOf("/") + 1)
    : "";
  const launchPath = launchHref ? normaliseZipPath(`${manifestBase}${launchHref}`) : null;
  const htmlEntry =
    (launchPath ? entryByLowerPath.get(launchPath.toLowerCase()) : null) ??
    entries.find((entry) => /\.(html?|xhtml)$/i.test(entry.path));
  if (htmlEntry && htmlEntry.uncompressedSize > MAX_HTML_BYTES) {
    throw new Error("SCORM launch HTML is too large to import.");
  }

  const contentHtml = htmlEntry
    ? decoder.decode(readEntry(data, htmlEntry))
    : `<p>Imported SCORM package. Launch file: ${escapeHtml(launchHref ?? "not declared")}.</p>`;
  const title = textContent(manifest, "title") || htmlTitle(contentHtml) || "Imported SCORM module";
  const launchLabel = launchHref ?? htmlEntry?.path ?? "not declared";

  return {
    title,
    description: `Imported from SCORM package. Launch file: ${launchLabel}.`,
    durationSeconds: 300,
    topic: "scorm",
    contentHtml,
  };
}

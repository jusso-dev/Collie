import { publicAppUrl } from "@/lib/tracking/public-url";

export type AttachmentSimulationKind = "attachment_pdf" | "attachment_html";

export type SimulationAttachmentPayload = {
  filename: string;
  contentType: "application/pdf" | "text/html";
  content: Buffer | string;
  metadata: {
    kind: AttachmentSimulationKind;
    filename: string;
    contentType: "application/pdf" | "text/html";
    clickUrl: string;
    pixelUrl?: string;
    safeSimulation: true;
  };
};

type AttachmentRendererInput = {
  kind: AttachmentSimulationKind | string | null | undefined;
  organisationName: string;
  subject: string;
  token: string;
  employee: {
    email: string;
    firstName: string;
    lastName: string;
    department?: string | null;
  };
};

function trackingUrlFor(token: string, source: "attachment_pdf" | "attachment_html") {
  const baseUrl = publicAppUrl();
  return `${baseUrl}/c/${encodeURIComponent(token)}?source=${source}`;
}

function openPixelUrlFor(token: string) {
  return `${publicAppUrl()}/p/${encodeURIComponent(token)}.gif?source=attachment_html`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function safeFilenamePart(value: string) {
  const normalised = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalised || "simulation-document").slice(0, 48);
}

function fullName(input: AttachmentRendererInput["employee"]) {
  return `${input.firstName} ${input.lastName}`.trim() || input.email;
}

function renderHtmlAttachment(input: AttachmentRendererInput): SimulationAttachmentPayload {
  const clickUrl = trackingUrlFor(input.token, "attachment_html");
  const pixelUrl = openPixelUrlFor(input.token);
  const filename = `${safeFilenamePart(input.subject)}.html`;
  const recipientName = fullName(input.employee);
  const title = input.subject || "Document preview";
  const content = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font-family: Inter, Arial, sans-serif; background: #f8fafc; color: #102033; }
      main { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
      .document { border: 1px solid #d9e2ec; border-radius: 8px; background: #fff; padding: 28px; }
      .label { color: #64748b; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { font-size: 28px; line-height: 1.16; margin: 10px 0 16px; }
      p { color: #334155; font-size: 16px; line-height: 1.55; }
      a { color: #0f766e; font-weight: 700; }
      .fineprint { color: #64748b; font-size: 12px; margin-top: 28px; }
    </style>
  </head>
  <body>
    <main>
      <section class="document" aria-label="Document preview">
        <div class="label">Document preview</div>
        <h1>${escapeHtml(title)}</h1>
        <p>Hello ${escapeHtml(recipientName)},</p>
        <p>This preview is part of a ${escapeHtml(input.organisationName)} security awareness simulation. It contains no scripts, credential forms, macros, or active document content.</p>
        <p><a href="${escapeHtml(clickUrl)}">Open the training follow-up</a></p>
        <p class="fineprint">Simulation token: ${escapeHtml(input.token)}</p>
      </section>
    </main>
    <img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:none;border:0;height:1px;width:1px" />
  </body>
</html>`;

  return {
    filename,
    contentType: "text/html",
    content,
    metadata: {
      kind: "attachment_html",
      filename,
      contentType: "text/html",
      clickUrl,
      pixelUrl,
      safeSimulation: true,
    },
  };
}

function pdfObject(value: string | Buffer) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

function buildPdf(objects: Array<string | Buffer>) {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets: number[] = [0];
  let cursor = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(cursor);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "utf8"),
      pdfObject(object),
      Buffer.from("\nendobj\n", "utf8"),
    ]);
    chunks.push(chunk);
    cursor += chunk.length;
  });

  const xrefOffset = cursor;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref, "utf8"));

  return Buffer.concat(chunks);
}

function renderPdfAttachment(input: AttachmentRendererInput): SimulationAttachmentPayload {
  const clickUrl = trackingUrlFor(input.token, "attachment_pdf");
  const filename = `${safeFilenamePart(input.subject)}.pdf`;
  const title = input.subject || "Document preview";
  const lines = [
    title,
    `Prepared for ${fullName(input.employee)}`,
    "",
    "This is safe simulation content.",
    "No macros, scripts, forms, or embedded files are present.",
    "",
    "Open the training follow-up:",
    clickUrl,
    "",
    `Simulation token: ${input.token}`,
  ];
  const textOperators = lines
    .map((line, index) => `${index === 0 ? "0 0 Td" : "0 -24 Td"} (${escapePdfText(line)}) Tj`)
    .join("\n");
  const stream = Buffer.from(`BT\n/F1 14 Tf\n72 720 Td\n${textOperators}\nET\n`, "utf8");
  const contentStream = Buffer.concat([
    Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "utf8"),
    stream,
    Buffer.from("endstream", "utf8"),
  ]);
  const uri = escapePdfText(clickUrl);
  const content = buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>",
    contentStream,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Annot /Subtype /Link /Rect [72 552 420 572] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`,
  ]);

  return {
    filename,
    contentType: "application/pdf",
    content,
    metadata: {
      kind: "attachment_pdf",
      filename,
      contentType: "application/pdf",
      clickUrl,
      safeSimulation: true,
    },
  };
}

export function renderSimulationAttachments(input: AttachmentRendererInput): SimulationAttachmentPayload[] {
  if (input.kind === "attachment_pdf") return [renderPdfAttachment(input)];
  if (input.kind === "attachment_html") return [renderHtmlAttachment(input)];
  return [];
}

import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { openTotpSecret, sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaignVariants,
  campaigns,
  emailTemplates,
  employees,
  landingPages,
  organisations,
  trainingCertificates,
  trainingModules,
  type TrainingCertificateJson,
} from "@/lib/db/schema";
import { publicAppUrl } from "@/lib/tracking/public-url";

export type CertificatePackage = {
  certificate: TrainingCertificateJson;
  hash: string;
  signature: string;
  signingPublicKey: string;
  signingPublicKeySha256: string;
  verifyUrl: string;
};

type SigningKey = {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeySha256: string;
};

export function certificateDownloadUrl(token: string): string {
  return `${publicAppUrl()}/certificates/${encodeURIComponent(token)}`;
}

export function certificateVerifyUrl(): string {
  return `${publicAppUrl()}/api/v1/certificates/verify`;
}

export function hashCertificateJson(certificate: unknown): string {
  return crypto.createHash("sha256").update(stableJsonStringify(certificate), "utf8").digest("hex");
}

export function hashCertificateDownloadToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export async function issueTrainingCertificateForTarget(input: {
  campaignTargetId: string;
  completedAt?: Date;
}): Promise<{ certificateId: string; downloadUrl: string } | null> {
  const existing = await certificateByTargetId(input.campaignTargetId);
  if (existing) return existing;

  const row = await targetCertificateData(input.campaignTargetId);
  if (!row) return null;

  const issuedAt = new Date();
  const completedAt = input.completedAt ?? row.trainingCompletedAt ?? issuedAt;
  const trainingModule = await moduleForCertificate(
    row.variantLinkedTrainingModuleId ?? row.landingLinkedTrainingModuleId ?? row.templateLinkedTrainingModuleId,
  );
  const certificateId = crypto.randomUUID();
  const signingKey = await organisationSigningKey(row.organisationId);
  const downloadToken = crypto.randomBytes(32).toString("base64url");
  const certificate: TrainingCertificateJson = {
    version: 1,
    certificateId,
    issuer: "Collie",
    organisation: {
      id: row.organisationId,
      name: row.organisationName,
    },
    employee: {
      id: row.employeeId,
      name: `${row.firstName} ${row.lastName}`.trim() || row.employeeEmail,
      email: row.employeeEmail,
    },
    training: {
      moduleId: trainingModule?.id ?? null,
      title: trainingModule?.title ?? "Security awareness training",
      topic: trainingModule?.topic ?? "Security awareness",
      durationSeconds: trainingModule?.durationSeconds ?? null,
    },
    completion: {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      campaignTargetId: row.campaignTargetId,
      completedAt: completedAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
    },
  };
  const hash = hashCertificateJson(certificate);
  const signature = crypto.sign(null, Buffer.from(hash, "hex"), signingKey.privateKeyPem).toString("base64url");

  const inserted = await db
    .insert(trainingCertificates)
    .values({
      id: certificateId,
      organisationId: row.organisationId,
      employeeId: row.employeeId,
      trainingModuleId: trainingModule?.id ?? null,
      campaignTargetId: row.campaignTargetId,
      certificateJson: certificate,
      certificateJsonHash: hash,
      signature,
      signingPublicKey: signingKey.publicKeyPem,
      signingPublicKeySha256: signingKey.publicKeySha256,
      downloadTokenEncrypted: sealTotpSecret(downloadToken),
      downloadTokenHash: hashCertificateDownloadToken(downloadToken),
      issuedAt,
    })
    .onConflictDoNothing()
    .returning({ id: trainingCertificates.id });

  await db
    .update(employees)
    .set({ lastTrainedAt: completedAt, updatedAt: issuedAt })
    .where(and(eq(employees.id, row.employeeId), eq(employees.organisationId, row.organisationId)));

  if (inserted[0]) {
    return { certificateId, downloadUrl: certificateDownloadUrl(downloadToken) };
  }

  return certificateByTargetId(input.campaignTargetId);
}

export async function certificatePackageForDownloadToken(token: string): Promise<CertificatePackage | null> {
  const [row] = await db
    .select({
      certificate: trainingCertificates.certificateJson,
      hash: trainingCertificates.certificateJsonHash,
      signature: trainingCertificates.signature,
      signingPublicKey: trainingCertificates.signingPublicKey,
      signingPublicKeySha256: trainingCertificates.signingPublicKeySha256,
      revokedAt: trainingCertificates.revokedAt,
    })
    .from(trainingCertificates)
    .where(eq(trainingCertificates.downloadTokenHash, hashCertificateDownloadToken(token)))
    .limit(1);

  if (!row || row.revokedAt) return null;

  return {
    certificate: row.certificate,
    hash: row.hash,
    signature: row.signature,
    signingPublicKey: row.signingPublicKey,
    signingPublicKeySha256: row.signingPublicKeySha256,
    verifyUrl: certificateVerifyUrl(),
  };
}

export async function verifyCertificatePackage(input: {
  certificate: unknown;
  signature: string;
}): Promise<
  | {
      ok: true;
      certificateId: string;
      hash: string;
      issuedAt: string;
      organisationName: string;
      employeeEmail: string;
      trainingTitle: string;
    }
  | { ok: false; status: number; error: string; hash?: string }
> {
  const certificateId = certificateIdFromUnknown(input.certificate);
  if (!certificateId) {
    return { ok: false, status: 400, error: "Certificate JSON is missing a certificateId." };
  }

  const [row] = await db
    .select({
      certificate: trainingCertificates.certificateJson,
      hash: trainingCertificates.certificateJsonHash,
      signature: trainingCertificates.signature,
      signingPublicKey: trainingCertificates.signingPublicKey,
      revokedAt: trainingCertificates.revokedAt,
    })
    .from(trainingCertificates)
    .where(eq(trainingCertificates.id, certificateId))
    .limit(1);

  if (!row) {
    return { ok: false, status: 404, error: "Certificate is unknown." };
  }
  if (row.revokedAt) {
    return { ok: false, status: 410, error: "Certificate has been revoked." };
  }

  const hash = hashCertificateJson(input.certificate);
  if (!timingSafeEqualText(hash, row.hash)) {
    return { ok: false, status: 400, error: "Certificate JSON has been modified.", hash };
  }
  if (!timingSafeEqualText(input.signature, row.signature)) {
    return { ok: false, status: 400, error: "Certificate signature does not match the issued certificate.", hash };
  }

  const signatureOk = crypto.verify(
    null,
    Buffer.from(hash, "hex"),
    row.signingPublicKey,
    Buffer.from(input.signature, "base64url"),
  );
  if (!signatureOk) {
    return { ok: false, status: 400, error: "Certificate signature is invalid.", hash };
  }

  return {
    ok: true,
    certificateId,
    hash,
    issuedAt: row.certificate.completion.issuedAt,
    organisationName: row.certificate.organisation.name,
    employeeEmail: row.certificate.employee.email,
    trainingTitle: row.certificate.training.title,
  };
}

export function renderCertificatePdf(pkg: CertificatePackage): Buffer {
  const certificate = pkg.certificate;
  const completed = new Date(certificate.completion.completedAt).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const lines = [
    { text: "Certificate of Training Completion", x: 72, y: 742, size: 24 },
    { text: certificate.organisation.name, x: 72, y: 704, size: 14 },
    { text: "This certifies that", x: 72, y: 648, size: 12 },
    { text: certificate.employee.name, x: 72, y: 616, size: 22 },
    { text: certificate.employee.email, x: 72, y: 590, size: 11 },
    { text: "completed", x: 72, y: 540, size: 12 },
    { text: certificate.training.title, x: 72, y: 508, size: 20 },
    { text: `Topic: ${certificate.training.topic}`, x: 72, y: 480, size: 11 },
    { text: `Completion date: ${completed}`, x: 72, y: 436, size: 12 },
    { text: `Campaign: ${certificate.completion.campaignName}`, x: 72, y: 412, size: 11 },
    { text: `Certificate ID: ${certificate.certificateId}`, x: 72, y: 350, size: 9 },
    { text: `SHA-256: ${pkg.hash}`, x: 72, y: 330, size: 9 },
    { text: `Signature: ${pkg.signature.slice(0, 72)}...`, x: 72, y: 310, size: 9 },
    { text: `Verify: ${pkg.verifyUrl}`, x: 72, y: 290, size: 9 },
  ];
  const content = [
    "0.96 0.97 0.99 rg 40 260 515 520 re f",
    "0.20 0.28 0.36 RG 40 260 515 520 re S",
    ...lines.map((line) => pdfText(line.text, line.x, line.y, line.size)),
  ].join("\n");

  return buildPdf(content);
}

async function certificateByTargetId(campaignTargetId: string) {
  const [row] = await db
    .select({
      certificateId: trainingCertificates.id,
      downloadTokenEncrypted: trainingCertificates.downloadTokenEncrypted,
      revokedAt: trainingCertificates.revokedAt,
    })
    .from(trainingCertificates)
    .where(eq(trainingCertificates.campaignTargetId, campaignTargetId))
    .limit(1);

  if (!row || row.revokedAt) return null;

  return {
    certificateId: row.certificateId,
    downloadUrl: certificateDownloadUrl(openTotpSecret(row.downloadTokenEncrypted)),
  };
}

async function targetCertificateData(campaignTargetId: string) {
  const variantTemplates = alias(emailTemplates, "variant_email_templates");

  const [row] = await db
    .select({
      campaignTargetId: campaignTargets.id,
      trainingCompletedAt: campaignTargets.trainingCompletedAt,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      organisationId: organisations.id,
      organisationName: organisations.name,
      employeeId: employees.id,
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      templateLinkedTrainingModuleId: emailTemplates.linkedTrainingModuleId,
      variantLinkedTrainingModuleId: variantTemplates.linkedTrainingModuleId,
      landingLinkedTrainingModuleId: landingPages.linkedTrainingModuleId,
    })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(organisations, eq(organisations.id, campaigns.organisationId))
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .leftJoin(campaignVariants, eq(campaignVariants.id, campaignTargets.campaignVariantId))
    .leftJoin(variantTemplates, eq(variantTemplates.id, campaignVariants.templateId))
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .leftJoin(landingPages, eq(landingPages.id, campaigns.landingPageId))
    .where(eq(campaignTargets.id, campaignTargetId))
    .limit(1);

  return row ?? null;
}

async function moduleForCertificate(moduleId: string | null) {
  if (!moduleId) return null;

  const [module] = await db
    .select({
      id: trainingModules.id,
      title: trainingModules.title,
      topic: trainingModules.topic,
      durationSeconds: trainingModules.durationSeconds,
    })
    .from(trainingModules)
    .where(eq(trainingModules.id, moduleId))
    .limit(1);

  return module ?? null;
}

async function organisationSigningKey(organisationId: string): Promise<SigningKey> {
  const [organisation] = await db
    .select({
      privateKeyEncrypted: organisations.certificateSigningPrivateKeyEncrypted,
      publicKey: organisations.certificateSigningPublicKey,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);

  if (!organisation) {
    throw new Error("Organisation not found for certificate signing.");
  }
  if (organisation.privateKeyEncrypted && organisation.publicKey) {
    return {
      privateKeyPem: openTotpSecret(organisation.privateKeyEncrypted),
      publicKeyPem: organisation.publicKey,
      publicKeySha256: publicKeySha256(organisation.publicKey),
    };
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  await db
    .update(organisations)
    .set({
      certificateSigningPrivateKeyEncrypted: sealTotpSecret(privateKeyPem),
      certificateSigningPublicKey: publicKeyPem,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisationId));

  return {
    privateKeyPem,
    publicKeyPem,
    publicKeySha256: publicKeySha256(publicKeyPem),
  };
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`)
    .join(",")}}`;
}

function certificateIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const certificateId = (value as Record<string, unknown>).certificateId;
  return typeof certificateId === "string" && certificateId.length > 0 ? certificateId : null;
}

function timingSafeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicKeySha256(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(publicKeyPem, "utf8").digest("hex");
}

function pdfText(text: string, x: number, y: number, size: number): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 100)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildPdf(content: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

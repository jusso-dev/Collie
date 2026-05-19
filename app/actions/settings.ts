"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { recordAudit } from "@/lib/audit/record";
import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { organisations } from "@/lib/db/schema";
import {
  DEFAULT_EVENT_METADATA_RETENTION_DAYS,
  DEFAULT_EVENT_PII_SCRUB_DAYS,
} from "@/lib/compliance/event-retention";
import {
  getTransportForOrganisation,
  renderTestEmailFor,
  TransientSendError,
  type OrganisationTransportConfig,
} from "@/lib/email/campaign-sender";
import { pathWithToast } from "@/lib/navigation/toast";

const PASSWORD_PLACEHOLDER = "__keep_existing__";

const transportEnum = z.enum(["resend", "smtp"]);

const complianceRetentionSettingsSchema = z.object({
  orgSlug: z.string().min(1),
  auditRetentionDays: z
    .string()
    .trim()
    .optional()
    .default(String(DEFAULT_EVENT_METADATA_RETENTION_DAYS))
    .transform((value) => Number(value || DEFAULT_EVENT_METADATA_RETENTION_DAYS))
    .pipe(z.number().int().min(30).max(2555)),
  eventPiiScrubDays: z
    .string()
    .trim()
    .optional()
    .default(String(DEFAULT_EVENT_PII_SCRUB_DAYS))
    .transform((value) => Number(value || DEFAULT_EVENT_PII_SCRUB_DAYS))
    .pipe(z.number().int().min(1).max(365)),
});

const sendingSettingsSchema = z
  .object({
    orgSlug: z.string().min(1),
    transport: transportEnum,
    senderFromAddress: z
      .string()
      .trim()
      .email("Enter a sender From address")
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : null)),
    resendApiKey: z.string().trim().optional().default(""),
    smtpHost: z.string().trim().optional().default(""),
    smtpPort: z
      .string()
      .trim()
      .optional()
      .default("")
      .transform((value) => (value ? Number(value) : null))
      .pipe(z.number().int().positive().max(65535).nullable()),
    smtpUsername: z.string().trim().optional().default(""),
    smtpPassword: z.string().optional().default(""),
    smtpSecure: z
      .string()
      .optional()
      .transform((value) => value === "on" || value === "true"),
    smtpFromAddress: z
      .string()
      .trim()
      .optional()
      .default("")
      .transform((value) => (value ? value : null))
      .pipe(z.string().email("Enter a valid SMTP From address").nullable()),
  })
  .superRefine((value, ctx) => {
    if (value.transport === "resend") {
      if (!value.resendApiKey || value.resendApiKey.length < 8) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resendApiKey"], message: "Enter a Resend API key." });
      }
      if (!value.senderFromAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["senderFromAddress"],
          message: "Enter a sender From address for Resend.",
        });
      }
    } else {
      if (!value.smtpHost) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpHost"], message: "Enter an SMTP host." });
      }
      if (!value.smtpPort) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpPort"], message: "Enter an SMTP port." });
      }
      if (!value.smtpFromAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["smtpFromAddress"],
          message: "Enter an SMTP From address.",
        });
      }
    }
  });

const lrsSettingsSchema = z
  .object({
    orgSlug: z.string().min(1),
    lrsEnabled: z
      .string()
      .optional()
      .transform((value) => value === "on" || value === "true"),
    lrsEndpointUrl: z
      .string()
      .trim()
      .optional()
      .default("")
      .transform((value) => (value ? value.replace(/\/$/, "") : null)),
    lrsUsername: z.string().trim().optional().default(""),
    lrsPassword: z.string().optional().default(""),
    hasExistingUsername: z
      .string()
      .optional()
      .transform((value) => value === "true"),
    hasExistingPassword: z
      .string()
      .optional()
      .transform((value) => value === "true"),
  })
  .superRefine((value, ctx) => {
    if (!value.lrsEnabled) return;

    if (!value.lrsEndpointUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lrsEndpointUrl"], message: "Enter an LRS endpoint URL." });
    } else {
      try {
        new URL(value.lrsEndpointUrl);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lrsEndpointUrl"], message: "Enter a valid LRS endpoint URL." });
      }
    }

    if (!value.lrsUsername && !value.hasExistingUsername) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lrsUsername"], message: "Enter an LRS username." });
    }

    if (!value.lrsPassword && !value.hasExistingPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lrsPassword"], message: "Enter an LRS password." });
    }
  });

function stringFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function rawFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function saveSendingSettings(formData: FormData) {
  const data = sendingSettingsSchema.parse({
    orgSlug: stringFromForm(formData, "orgSlug"),
    transport: stringFromForm(formData, "transport") || "resend",
    senderFromAddress: stringFromForm(formData, "senderFromAddress"),
    resendApiKey: stringFromForm(formData, "resendApiKey"),
    smtpHost: stringFromForm(formData, "smtpHost"),
    smtpPort: stringFromForm(formData, "smtpPort"),
    smtpUsername: stringFromForm(formData, "smtpUsername"),
    smtpPassword: rawFromForm(formData, "smtpPassword"),
    smtpSecure: stringFromForm(formData, "smtpSecure"),
    smtpFromAddress: stringFromForm(formData, "smtpFromAddress"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  const updates: Partial<typeof organisations.$inferInsert> = {
    sendingTransport: data.transport,
    updatedAt: new Date(),
  };

  if (data.senderFromAddress) {
    updates.senderFromAddress = data.senderFromAddress;
  }

  if (data.transport === "resend") {
    if (data.resendApiKey) {
      updates.resendApiKeyEncrypted = sealTotpSecret(data.resendApiKey);
    } else if (organisation.resendApiKeyEncrypted && /^re_[A-Za-z0-9_-]+$/.test(organisation.resendApiKeyEncrypted)) {
      updates.resendApiKeyEncrypted = sealTotpSecret(organisation.resendApiKeyEncrypted);
    }
  } else {
    updates.smtpHost = data.smtpHost || null;
    updates.smtpPort = data.smtpPort;
    updates.smtpSecure = data.smtpSecure;
    updates.smtpFromAddress = data.smtpFromAddress;

    if (data.smtpUsername) {
      updates.smtpUsernameEncrypted = sealTotpSecret(data.smtpUsername);
    } else if (formData.has("smtpUsername") && stringFromForm(formData, "smtpUsername") === "") {
      updates.smtpUsernameEncrypted = null;
    }

    // Treat empty string as "no change", explicit placeholder also = "no
    // change". Anything else replaces the sealed password. This lets the form
    // re-render without leaking the cleartext password to the client.
    if (data.smtpPassword && data.smtpPassword !== PASSWORD_PLACEHOLDER) {
      updates.smtpPasswordEncrypted = sealTotpSecret(data.smtpPassword);
    }
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, organisation.id));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "settings.save_sending",
    resourceType: "organisation",
    resourceId: organisation.id,
    metadata: { senderFromAddress: data.senderFromAddress },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/settings?tab=sending`, "settings-sending"), RedirectType.replace);
}

export async function saveComplianceRetentionSettings(formData: FormData) {
  const data = complianceRetentionSettingsSchema.parse({
    orgSlug: stringFromForm(formData, "orgSlug"),
    auditRetentionDays: stringFromForm(formData, "auditRetentionDays"),
    eventPiiScrubDays: stringFromForm(formData, "eventPiiScrubDays"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  await db
    .update(organisations)
    .set({
      auditRetentionDays: data.auditRetentionDays,
      eventPiiScrubDays: data.eventPiiScrubDays,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisation.id));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "settings.save_compliance_retention",
    resourceType: "organisation",
    resourceId: organisation.id,
    metadata: {
      eventMetadataRetentionDays: data.auditRetentionDays,
      eventPiiScrubDays: data.eventPiiScrubDays,
    },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
  redirect(pathWithToast(`/${data.orgSlug}/settings?tab=compliance`, "settings-retention"), RedirectType.replace);
}

export async function saveLrsSettings(formData: FormData) {
  const data = lrsSettingsSchema.parse({
    orgSlug: stringFromForm(formData, "orgSlug"),
    lrsEnabled: stringFromForm(formData, "lrsEnabled"),
    lrsEndpointUrl: stringFromForm(formData, "lrsEndpointUrl"),
    lrsUsername: stringFromForm(formData, "lrsUsername"),
    lrsPassword: rawFromForm(formData, "lrsPassword"),
    hasExistingUsername: stringFromForm(formData, "hasExistingUsername"),
    hasExistingPassword: stringFromForm(formData, "hasExistingPassword"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  const updates: Partial<typeof organisations.$inferInsert> = {
    lrsEnabled: data.lrsEnabled,
    lrsEndpointUrl: data.lrsEndpointUrl,
    updatedAt: new Date(),
  };

  if (data.lrsUsername) {
    updates.lrsUsernameEncrypted = sealTotpSecret(data.lrsUsername);
  }

  if (data.lrsPassword && data.lrsPassword !== PASSWORD_PLACEHOLDER) {
    updates.lrsPasswordEncrypted = sealTotpSecret(data.lrsPassword);
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, organisation.id));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "settings.save_lrs",
    resourceType: "organisation",
    resourceId: organisation.id,
    metadata: { lrsEnabled: data.lrsEnabled, lrsEndpointUrl: data.lrsEndpointUrl },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
  redirect(pathWithToast(`/${data.orgSlug}/settings?tab=training`, "settings-lrs"), RedirectType.replace);
}

const testSendSchema = z.object({
  orgSlug: z.string().min(1),
  recipient: z.string().trim().email("Enter a recipient email address"),
});

export type TransportTestResult =
  | { ok: true; transport: "resend" | "smtp"; messageId: string | null; recipient: string }
  | { ok: false; transport: "resend" | "smtp" | "unknown"; error: string };

export async function sendTransportTestEmail(_prevState: TransportTestResult | null, formData: FormData): Promise<TransportTestResult> {
  let parsed;
  try {
    parsed = testSendSchema.parse({
      orgSlug: stringFromForm(formData, "orgSlug"),
      recipient: stringFromForm(formData, "recipient"),
    });
  } catch (error) {
    return {
      ok: false,
      transport: "unknown",
      error: error instanceof z.ZodError ? (error.issues[0]?.message ?? "Invalid input") : "Invalid input",
    };
  }

  let organisation;
  try {
    organisation = await requireOrganisationRoleForSlug(parsed.orgSlug, ["owner", "admin"]);
  } catch (error) {
    return {
      ok: false,
      transport: "unknown",
      error: error instanceof Error ? error.message : "Access denied",
    };
  }

  const config: OrganisationTransportConfig = {
    name: organisation.name,
    sendingTransport: organisation.sendingTransport,
    senderFromAddress: organisation.senderFromAddress,
    resendApiKeyEncrypted: organisation.resendApiKeyEncrypted,
    smtpHost: organisation.smtpHost,
    smtpPort: organisation.smtpPort,
    smtpUsernameEncrypted: organisation.smtpUsernameEncrypted,
    smtpPasswordEncrypted: organisation.smtpPasswordEncrypted,
    smtpSecure: organisation.smtpSecure,
    smtpFromAddress: organisation.smtpFromAddress,
  };

  try {
    const transport = getTransportForOrganisation(config);
    const result = await transport.send(renderTestEmailFor({ organisationName: organisation.name, recipient: parsed.recipient }));

    return {
      ok: true,
      transport: result.transport,
      messageId: result.messageId,
      recipient: parsed.recipient,
    };
  } catch (error) {
    const transportName: "resend" | "smtp" =
      organisation.sendingTransport === "smtp" ? "smtp" : "resend";

    if (error instanceof TransientSendError) {
      return {
        ok: false,
        transport: error.transport,
        error: `Transient ${error.transport.toUpperCase()} ${error.code ?? ""} — ${error.message}`.trim(),
      };
    }

    return {
      ok: false,
      transport: transportName,
      error: error instanceof Error ? error.message : "Send failed",
    };
  }
}

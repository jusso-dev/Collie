import { headers } from "next/headers";

import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export type RecordAuditInput = {
  organisationId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

function pickIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first ? first : null;
}

async function resolveRequestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const hdrs = await headers();
    const forwarded = hdrs.get("x-forwarded-for");
    const realIp = hdrs.get("x-real-ip");
    const ip = pickIp(forwarded) ?? pickIp(realIp);
    const userAgent = hdrs.get("user-agent");
    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Persist an audit log entry. Designed to be called from server actions and route
 * handlers — never throws to the caller. Failures are logged so they do not break
 * the user-facing mutation flow.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const requestContext = await resolveRequestContext();
    const ip = input.ip === undefined ? requestContext.ip : input.ip;
    const userAgent = input.userAgent === undefined ? requestContext.userAgent : input.userAgent;

    await db.insert(auditLog).values({
      organisationId: input.organisationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    });
  } catch (error) {
    // Audit logging must never break the mutating call site. Surface the failure
    // to server logs so operators can detect dropped audit entries.
    console.error("[audit] failed to record entry", {
      action: input.action,
      resourceType: input.resourceType,
      organisationId: input.organisationId,
      error,
    });
  }
}

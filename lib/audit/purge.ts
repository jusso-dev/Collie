import { sql } from "drizzle-orm";

import { DEFAULT_EVENT_METADATA_RETENTION_DAYS } from "@/lib/compliance/event-retention";
import { db } from "@/lib/db/client";
import { auditLog, organisations } from "@/lib/db/schema";

export const AUDIT_PURGE_DEFAULT_BATCH_SIZE = 10_000;
export const AUDIT_PURGE_MAX_BATCHES_PER_ORG = 1_000;

type CountRow = { count: number };

export type AuditPurgeOrgResult = {
  organisationId: string;
  retentionDays: number;
  cutoff: string;
  deleted: number;
  batches: number;
  capped: boolean;
};

export type AuditPurgeRunResult = {
  organisationsProcessed: number;
  totalDeleted: number;
  perOrg: AuditPurgeOrgResult[];
  errors: string[];
};

function countFromResult(result: unknown): number {
  const rows = Array.isArray(result) ? (result as CountRow[]) : [];
  return Number(rows[0]?.count ?? 0);
}

async function deleteBatch(orgId: string, cutoff: Date, batchSize: number): Promise<number> {
  const result = await db.execute(sql`
    with target_rows as (
      select id
      from ${auditLog}
      where ${auditLog.organisationId} = ${orgId}
        and ${auditLog.createdAt} < ${cutoff}
      order by ${auditLog.createdAt}
      limit ${batchSize}
    ),
    deleted as (
      delete from ${auditLog}
      where ${auditLog.organisationId} = ${orgId}
        and ${auditLog.id} in (select id from target_rows)
      returning 1
    )
    select count(*)::int as count from deleted
  `);
  return countFromResult(result);
}

export async function purgeAuditLogsForOrganisation(
  orgId: string,
  retentionDays: number,
  options: { batchSize?: number; now?: Date } = {},
): Promise<AuditPurgeOrgResult> {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new RangeError(`retentionDays must be a positive integer (received ${String(retentionDays)})`);
  }

  const batchSize = options.batchSize ?? AUDIT_PURGE_DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError(`batchSize must be a positive integer (received ${String(batchSize)})`);
  }

  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let batches = 0;
  let deleted = 0;
  let capped = false;

  while (batches < AUDIT_PURGE_MAX_BATCHES_PER_ORG) {
    const removed = await deleteBatch(orgId, cutoff, batchSize);
    batches += 1;
    deleted += removed;
    if (removed < batchSize) break;
    if (batches === AUDIT_PURGE_MAX_BATCHES_PER_ORG) {
      capped = true;
    }
  }

  return {
    organisationId: orgId,
    retentionDays,
    cutoff: cutoff.toISOString(),
    deleted,
    batches,
    capped,
  };
}

export async function purgeExpiredAuditLogs(
  options: { batchSize?: number; now?: Date } = {},
): Promise<AuditPurgeRunResult> {
  const orgs = await db
    .select({
      id: organisations.id,
      retentionDays: organisations.auditRetentionDays,
    })
    .from(organisations);

  const perOrg: AuditPurgeOrgResult[] = [];
  const errors: string[] = [];
  let totalDeleted = 0;

  for (const org of orgs) {
    try {
      const effectiveRetentionDays =
        typeof org.retentionDays === "number" && Number.isInteger(org.retentionDays) && org.retentionDays > 0
          ? org.retentionDays
          : DEFAULT_EVENT_METADATA_RETENTION_DAYS;
      if (effectiveRetentionDays !== org.retentionDays) {
        console.warn(
          `[audit-purge] org=${org.id} has invalid audit_retention_days=${String(org.retentionDays)}; falling back to ${effectiveRetentionDays}d`,
        );
      }

      const result = await purgeAuditLogsForOrganisation(org.id, effectiveRetentionDays, options);
      perOrg.push(result);
      totalDeleted += result.deleted;
      console.log(
        `[audit-purge] org=${org.id} retention=${effectiveRetentionDays}d cutoff=${result.cutoff} deleted=${result.deleted} batches=${result.batches}${result.capped ? " capped=true" : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${org.id}: ${message}`);
      console.error(`[audit-purge] org=${org.id} failed: ${message}`);
    }
  }

  return {
    organisationsProcessed: perOrg.length,
    totalDeleted,
    perOrg,
    errors,
  };
}

import { and, eq, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  auditLog,
  campaignTargets,
  campaigns,
  employees,
  events,
  organisations,
  realMailReports,
} from "@/lib/db/schema";

export const DEFAULT_EVENT_METADATA_RETENTION_DAYS = 395;
export const DEFAULT_EVENT_PII_SCRUB_DAYS = 90;

type CountRow = { count: number };

export type RetentionRunResult = {
  organisationsChecked: number;
  eventMetadataScrubbed: number;
  eventPiiScrubbed: number;
  auditMetadataScrubbed: number;
  auditPiiScrubbed: number;
};

export type DsarScrubResult = {
  matched: boolean;
  employeeId: string | null;
  redactedEmail: string | null;
  employeeRowsUpdated: number;
  eventsScrubbed: number;
  realMailReportsScrubbed: number;
};

function coercePositiveDays(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function cutoffDate(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function countFromResult(result: unknown): number {
  const rows = Array.isArray(result) ? (result as CountRow[]) : [];
  return Number(rows[0]?.count ?? 0);
}

async function countUpdated(query: Parameters<typeof db.execute>[0]) {
  return countFromResult(await db.execute(query));
}

export async function runEventRetention(now = new Date()): Promise<RetentionRunResult> {
  const tenants = await db
    .select({
      id: organisations.id,
      auditRetentionDays: organisations.auditRetentionDays,
      eventPiiScrubDays: organisations.eventPiiScrubDays,
    })
    .from(organisations);

  const result: RetentionRunResult = {
    organisationsChecked: tenants.length,
    eventMetadataScrubbed: 0,
    eventPiiScrubbed: 0,
    auditMetadataScrubbed: 0,
    auditPiiScrubbed: 0,
  };

  for (const tenant of tenants) {
    const metadataCutoff = cutoffDate(
      now,
      coercePositiveDays(tenant.auditRetentionDays, DEFAULT_EVENT_METADATA_RETENTION_DAYS),
    );
    const piiCutoff = cutoffDate(
      now,
      coercePositiveDays(tenant.eventPiiScrubDays, DEFAULT_EVENT_PII_SCRUB_DAYS),
    );

    result.eventMetadataScrubbed += await countUpdated(sql`
      with updated as (
        update ${events}
        set metadata = '{}'::jsonb
        from ${campaignTargets}, ${campaigns}
        where ${events.campaignTargetId} = ${campaignTargets.id}
          and ${campaignTargets.campaignId} = ${campaigns.id}
          and ${campaigns.organisationId} = ${tenant.id}
          and ${events.createdAt} < ${metadataCutoff}
          and ${events.metadata} <> '{}'::jsonb
        returning 1
      )
      select count(*)::int as count from updated
    `);

    result.eventPiiScrubbed += await countUpdated(sql`
      with updated as (
        update ${events}
        set ip_address = null, user_agent = null
        from ${campaignTargets}, ${campaigns}
        where ${events.campaignTargetId} = ${campaignTargets.id}
          and ${campaignTargets.campaignId} = ${campaigns.id}
          and ${campaigns.organisationId} = ${tenant.id}
          and ${events.createdAt} < ${piiCutoff}
          and (${events.ipAddress} is not null or ${events.userAgent} is not null)
        returning 1
      )
      select count(*)::int as count from updated
    `);

    result.auditMetadataScrubbed += await countUpdated(sql`
      with updated as (
        update ${auditLog}
        set metadata = '{}'::jsonb
        where ${auditLog.organisationId} = ${tenant.id}
          and ${auditLog.createdAt} < ${metadataCutoff}
          and ${auditLog.metadata} <> '{}'::jsonb
        returning 1
      )
      select count(*)::int as count from updated
    `);

    result.auditPiiScrubbed += await countUpdated(sql`
      with updated as (
        update ${auditLog}
        set ip_address = null, user_agent = null
        where ${auditLog.organisationId} = ${tenant.id}
          and ${auditLog.createdAt} < ${piiCutoff}
          and (${auditLog.ipAddress} is not null or ${auditLog.userAgent} is not null)
        returning 1
      )
      select count(*)::int as count from updated
    `);
  }

  return result;
}

export async function scrubEmployeePiiForDsar(input: {
  organisationId: string;
  email: string;
}): Promise<DsarScrubResult> {
  const email = input.email.trim().toLowerCase();
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organisationId, input.organisationId), eq(employees.email, email)))
    .limit(1);

  if (!employee) {
    return {
      matched: false,
      employeeId: null,
      redactedEmail: null,
      employeeRowsUpdated: 0,
      eventsScrubbed: 0,
      realMailReportsScrubbed: 0,
    };
  }

  const redactedEmail = `redacted-${employee.id}@dsar.invalid`;
  const now = new Date();

  const updatedEmployees = await db
    .update(employees)
    .set({
      email: redactedEmail,
      phoneNumber: null,
      firstName: "Redacted",
      lastName: "Employee",
      department: null,
      managerEmail: null,
      scimExternalId: null,
      exclusionReason: null,
      active: false,
      updatedAt: now,
    })
    .where(and(eq(employees.id, employee.id), eq(employees.organisationId, input.organisationId)))
    .returning({ id: employees.id });

  const eventsScrubbed = await countUpdated(sql`
    with updated as (
      update ${events}
      set metadata = '{}'::jsonb, ip_address = null, user_agent = null
      from ${campaignTargets}, ${campaigns}
      where ${events.campaignTargetId} = ${campaignTargets.id}
        and ${campaignTargets.campaignId} = ${campaigns.id}
        and ${campaigns.organisationId} = ${input.organisationId}
        and ${campaignTargets.employeeId} = ${employee.id}
        and (
          ${events.metadata} <> '{}'::jsonb
          or ${events.ipAddress} is not null
          or ${events.userAgent} is not null
        )
      returning 1
    )
    select count(*)::int as count from updated
  `);

  const reportRows = await db
    .update(realMailReports)
    .set({
      reporterEmployeeId: null,
      reporterEmail: redactedEmail,
      headersRaw: null,
      bodyPreview: null,
    })
    .where(
      and(
        eq(realMailReports.organisationId, input.organisationId),
        or(
          eq(realMailReports.reporterEmployeeId, employee.id),
          eq(realMailReports.reporterEmail, email),
        ),
      ),
    )
    .returning({ id: realMailReports.id });

  return {
    matched: true,
    employeeId: employee.id,
    redactedEmail,
    employeeRowsUpdated: updatedEmployees.length,
    eventsScrubbed,
    realMailReportsScrubbed: reportRows.length,
  };
}

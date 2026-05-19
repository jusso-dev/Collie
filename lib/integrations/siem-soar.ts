import crypto from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { openTotpSecret, sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  employees,
  events,
  organisations,
  type OutboundEndpointConfig,
  outboundDeadLetters,
  outboundDeliveries,
  outboundEndpoints,
  realMailReports,
} from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

export const SIEM_SOAR_EVENT_TYPES = [
  "clicked",
  "submitted",
  "reported",
  "real_mail_report",
] as const;

export type SiemSoarEventType = (typeof SIEM_SOAR_EVENT_TYPES)[number];
export type SiemSoarConnector = "sentinel" | "splunk_soar" | "cortex_xsoar" | "servicenow_sir";
export type SiemSoarFormat = "json" | "cef" | "leef";

type DeliveryStatus = "pending" | "retrying" | "succeeded" | "dead_letter";

type EndpointRow = {
  id: string;
  organisationId: string;
  name: string;
  connector: SiemSoarConnector;
  format: SiemSoarFormat;
  url: string;
  config: OutboundEndpointConfig;
  enabled: boolean;
  eventTypes: string[];
  maxAttempts: number;
};

type CanonicalSiemEvent = {
  id: string;
  type: SiemSoarEventType;
  occurredAt: string;
  sourceKind: "event" | "real_mail_report";
  organisation: {
    id: string;
    name: string;
    slug: string;
  };
  actor?: {
    employeeId: string | null;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    department?: string | null;
  };
  campaign?: {
    id: string;
    name: string;
    status: string;
    deliveryChannel: string;
  };
  target?: {
    id: string;
    token: string;
    deliveryChannel: string;
  };
  report?: {
    id: string;
    reporterEmail: string;
    sender: string;
    subject: string;
    severity: string;
    source: string;
    bodyHash: string | null;
    bodyPreview: string | null;
    urls: string[];
    attachmentCount: number;
  };
  metadata: Record<string, unknown>;
};

type DeliveryOutcome =
  | { status: "succeeded"; deliveryId: string }
  | { status: "retrying"; deliveryId: string; retryAt: Date }
  | { status: "dead_letter"; deliveryId: string; reason: string }
  | { status: "skipped"; deliveryId: string; reason: string };

function isSiemSoarEventType(value: string): value is SiemSoarEventType {
  return SIEM_SOAR_EVENT_TYPES.includes(value as SiemSoarEventType);
}

function generateSigningKey() {
  return `csk_${crypto.randomBytes(32).toString("base64url")}`;
}

function lastFour(value: string) {
  return value.slice(-4);
}

export async function ensureOrganisationSiemSoarSigningKey(organisationId: string) {
  const [row] = await db
    .select({
      encrypted: organisations.siemSoarSigningKeyEncrypted,
      last4: organisations.siemSoarSigningKeyLast4,
      createdAt: organisations.siemSoarSigningKeyCreatedAt,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);

  if (row?.encrypted) {
    return { key: openTotpSecret(row.encrypted), last4: row.last4, createdAt: row.createdAt };
  }

  return rotateOrganisationSiemSoarSigningKey(organisationId);
}

export async function rotateOrganisationSiemSoarSigningKey(organisationId: string) {
  const key = generateSigningKey();
  const now = new Date();

  await db
    .update(organisations)
    .set({
      siemSoarSigningKeyEncrypted: sealTotpSecret(key),
      siemSoarSigningKeyLast4: lastFour(key),
      siemSoarSigningKeyCreatedAt: now,
      updatedAt: now,
    })
    .where(eq(organisations.id, organisationId));

  return { key, last4: lastFour(key), createdAt: now };
}

function endpointReceives(endpoint: EndpointRow, eventType: SiemSoarEventType) {
  return endpoint.enabled && endpoint.eventTypes.includes(eventType);
}

async function enabledEndpointsFor(organisationId: string) {
  return db
    .select({
      id: outboundEndpoints.id,
      organisationId: outboundEndpoints.organisationId,
      name: outboundEndpoints.name,
      connector: outboundEndpoints.connector,
      format: outboundEndpoints.format,
      url: outboundEndpoints.url,
      config: outboundEndpoints.config,
      enabled: outboundEndpoints.enabled,
      eventTypes: outboundEndpoints.eventTypes,
      maxAttempts: outboundEndpoints.maxAttempts,
    })
    .from(outboundEndpoints)
    .where(and(eq(outboundEndpoints.organisationId, organisationId), eq(outboundEndpoints.enabled, true)));
}

function sourceIdFor(canonical: CanonicalSiemEvent) {
  return canonical.id;
}

async function enqueueCanonical(canonical: CanonicalSiemEvent) {
  const endpoints = (await enabledEndpointsFor(canonical.organisation.id)).filter((endpoint) =>
    endpointReceives(endpoint, canonical.type),
  );

  if (endpoints.length === 0) return { queued: 0 };

  await ensureOrganisationSiemSoarSigningKey(canonical.organisation.id);
  let queued = 0;

  for (const endpoint of endpoints) {
    const idempotencyKey = `${canonical.sourceKind}:${sourceIdFor(canonical)}:${canonical.type}`;
    const [delivery] = await db
      .insert(outboundDeliveries)
      .values({
        organisationId: canonical.organisation.id,
        endpointId: endpoint.id,
        eventType: canonical.type,
        sourceKind: canonical.sourceKind,
        sourceId: sourceIdFor(canonical),
        idempotencyKey,
        status: "pending",
        payload: canonical,
      })
      .onConflictDoNothing()
      .returning({ id: outboundDeliveries.id });

    if (!delivery) continue;
    queued += 1;

    try {
      await inngest.send({
        name: "siem-soar/delivery.requested",
        data: { deliveryId: delivery.id },
      });
    } catch (error) {
      console.warn("SIEM/SOAR delivery was queued but not signalled to Inngest", {
        deliveryId: delivery.id,
        error,
      });
    }
  }

  return { queued };
}

export async function enqueueSimulationEventPush(eventId: string) {
  const [row] = await db
    .select({
      eventId: events.id,
      eventType: events.eventType,
      eventMetadata: events.metadata,
      eventCreatedAt: events.createdAt,
      targetId: campaignTargets.id,
      targetToken: campaignTargets.uniqueToken,
      targetDeliveryChannel: campaignTargets.deliveryChannel,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignStatus: campaigns.status,
      campaignDeliveryChannel: campaigns.deliveryChannel,
      organisationId: organisations.id,
      organisationName: organisations.name,
      organisationSlug: organisations.slug,
      employeeId: employees.id,
      employeeEmail: employees.email,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      employeeDepartment: employees.department,
    })
    .from(events)
    .innerJoin(campaignTargets, eq(campaignTargets.id, events.campaignTargetId))
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(organisations, eq(organisations.id, campaigns.organisationId))
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(eq(events.id, eventId))
    .limit(1);

  if (!row || !isSiemSoarEventType(row.eventType)) return { queued: 0 };

  return enqueueCanonical({
    id: row.eventId,
    type: row.eventType,
    occurredAt: row.eventCreatedAt.toISOString(),
    sourceKind: "event",
    organisation: {
      id: row.organisationId,
      name: row.organisationName,
      slug: row.organisationSlug,
    },
    actor: {
      employeeId: row.employeeId,
      email: row.employeeEmail,
      firstName: row.employeeFirstName,
      lastName: row.employeeLastName,
      department: row.employeeDepartment,
    },
    campaign: {
      id: row.campaignId,
      name: row.campaignName,
      status: row.campaignStatus,
      deliveryChannel: row.campaignDeliveryChannel,
    },
    target: {
      id: row.targetId,
      token: row.targetToken,
      deliveryChannel: row.targetDeliveryChannel,
    },
    metadata: row.eventMetadata ?? {},
  });
}

export async function enqueueRealMailReportPush(reportId: string) {
  const [row] = await db
    .select({
      reportId: realMailReports.id,
      reporterEmail: realMailReports.reporterEmail,
      sender: realMailReports.sender,
      subject: realMailReports.subject,
      severity: realMailReports.severity,
      source: realMailReports.source,
      bodyHash: realMailReports.bodyHash,
      bodyPreview: realMailReports.bodyPreview,
      urls: realMailReports.urls,
      attachmentsMeta: realMailReports.attachmentsMeta,
      createdAt: realMailReports.createdAt,
      organisationId: organisations.id,
      organisationName: organisations.name,
      organisationSlug: organisations.slug,
      employeeId: employees.id,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      employeeDepartment: employees.department,
    })
    .from(realMailReports)
    .innerJoin(organisations, eq(organisations.id, realMailReports.organisationId))
    .leftJoin(employees, eq(employees.id, realMailReports.reporterEmployeeId))
    .where(eq(realMailReports.id, reportId))
    .limit(1);

  if (!row) return { queued: 0 };

  return enqueueCanonical({
    id: row.reportId,
    type: "real_mail_report",
    occurredAt: row.createdAt.toISOString(),
    sourceKind: "real_mail_report",
    organisation: {
      id: row.organisationId,
      name: row.organisationName,
      slug: row.organisationSlug,
    },
    actor: {
      employeeId: row.employeeId,
      email: row.reporterEmail,
      firstName: row.employeeFirstName,
      lastName: row.employeeLastName,
      department: row.employeeDepartment,
    },
    report: {
      id: row.reportId,
      reporterEmail: row.reporterEmail,
      sender: row.sender,
      subject: row.subject,
      severity: row.severity,
      source: row.source,
      bodyHash: row.bodyHash,
      bodyPreview: row.bodyPreview,
      urls: row.urls,
      attachmentCount: row.attachmentsMeta.length,
    },
    metadata: {},
  });
}

function severityFor(event: CanonicalSiemEvent) {
  if (event.type === "submitted") return "high";
  if (event.type === "clicked") return "medium";
  if (event.type === "reported") return "low";
  return event.report?.severity === "unknown" ? "medium" : (event.report?.severity ?? "medium");
}

function titleFor(event: CanonicalSiemEvent) {
  if (event.type === "real_mail_report") {
    return `Collie real-mail report: ${event.report?.subject ?? "unknown subject"}`;
  }
  return `Collie simulation ${event.type}: ${event.actor?.email ?? "unknown employee"}`;
}

function jsonPayload(endpoint: EndpointRow, event: CanonicalSiemEvent) {
  const severity = severityFor(event);
  const common = {
    source: "collie",
    connector: endpoint.connector,
    event_type: event.type,
    severity,
    occurred_at: event.occurredAt,
    organisation: event.organisation,
    actor: event.actor,
    campaign: event.campaign,
    target: event.target,
    report: event.report,
    metadata: event.metadata,
    raw_event: event,
  };

  if (endpoint.connector === "sentinel") {
    return {
      TimeGenerated: event.occurredAt,
      EventVendor: "Collie",
      EventProduct: "Collie",
      EventType: event.type,
      Severity: severity,
      TenantId: event.organisation.id,
      AccountName: event.actor?.email,
      CampaignName: event.campaign?.name,
      ReportSubject: event.report?.subject,
      RawEvent: event,
    };
  }

  if (endpoint.connector === "splunk_soar") {
    return {
      name: titleFor(event),
      label: event.type === "real_mail_report" ? "phishing_report" : "phishing_simulation",
      severity,
      source_data_identifier: event.id,
      artifacts: [
        {
          name: event.type,
          label: "collie_event",
          type: "network",
          cef: {
            sourceAddress: event.metadata.ipAddress,
            requestURL: event.report?.urls?.[0],
            destinationUserName: event.actor?.email,
            cs1: event.organisation.slug,
            cs1Label: "organisation_slug",
            cs2: event.campaign?.name,
            cs2Label: "campaign",
          },
          data: common,
        },
      ],
    };
  }

  if (endpoint.connector === "cortex_xsoar") {
    return {
      name: titleFor(event),
      occurred: event.occurredAt,
      severity,
      type: event.type === "real_mail_report" ? "Phishing" : "Phishing Simulation",
      labels: [
        { type: "organisation", value: event.organisation.slug },
        { type: "event_type", value: event.type },
      ],
      details: event.report?.bodyPreview ?? event.campaign?.name ?? titleFor(event),
      rawJSON: common,
    };
  }

  return {
    short_description: titleFor(event),
    description: event.report?.bodyPreview ?? JSON.stringify(common),
    category: "phishing",
    subcategory: event.type,
    severity,
    source: "Collie",
    caller_id: event.actor?.email,
    u_collie_event_id: event.id,
    u_collie_organisation: event.organisation.slug,
    additional_info: JSON.stringify(common),
  };
}

function sentinelCloudEndpoints(cloud: "public" | "usgov" | "china") {
  if (cloud === "usgov") {
    return {
      authorityHost: "https://login.microsoftonline.us",
      scope: "https://monitor.azure.us/.default",
    };
  }
  if (cloud === "china") {
    return {
      authorityHost: "https://login.chinacloudapi.cn",
      scope: "https://monitor.azure.cn/.default",
    };
  }
  return {
    authorityHost: "https://login.microsoftonline.com",
    scope: "https://monitor.azure.com/.default",
  };
}

function sentinelSeverityNumber(event: CanonicalSiemEvent) {
  if (event.type === "submitted") return 8;
  if (event.type === "clicked") return 5;
  if (event.type === "reported") return 2;
  return event.report?.severity === "high" ? 8 : event.report?.severity === "low" ? 2 : 5;
}

function sentinelRecord(event: CanonicalSiemEvent) {
  return {
    TimeGenerated: event.occurredAt,
    EventVendor: "Collie",
    EventProduct: "Collie",
    EventType: event.type,
    EventName: titleFor(event),
    Severity: severityFor(event),
    SeverityNumber: sentinelSeverityNumber(event),
    SourceKind: event.sourceKind,
    OrganisationId: event.organisation.id,
    OrganisationName: event.organisation.name,
    OrganisationSlug: event.organisation.slug,
    ActorEmployeeId: event.actor?.employeeId ?? null,
    ActorEmail: event.actor?.email ?? null,
    ActorDepartment: event.actor?.department ?? null,
    CampaignId: event.campaign?.id ?? null,
    CampaignName: event.campaign?.name ?? null,
    CampaignStatus: event.campaign?.status ?? null,
    TargetId: event.target?.id ?? null,
    TargetDeliveryChannel: event.target?.deliveryChannel ?? null,
    ReportId: event.report?.id ?? null,
    ReportSubject: event.report?.subject ?? null,
    ReportSender: event.report?.sender ?? null,
    ReportSeverity: event.report?.severity ?? null,
    Url: event.report?.urls?.[0] ?? null,
    Metadata: JSON.stringify(event.metadata ?? {}),
    RawEvent: JSON.stringify(event),
  };
}

function sentinelIngestionUrl(endpoint: EndpointRow) {
  const config = endpoint.config.sentinel;
  if (!config?.dcrImmutableId || !config.streamName) {
    throw new Error("Microsoft Sentinel endpoint is missing DCR immutable ID or stream name.");
  }

  const url = new URL(endpoint.url);
  if (!url.pathname.includes("/dataCollectionRules/")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/dataCollectionRules/${encodeURIComponent(
      config.dcrImmutableId,
    )}/streams/${encodeURIComponent(config.streamName)}`;
  }
  if (!url.searchParams.has("api-version")) {
    url.searchParams.set("api-version", "2023-01-01");
  }
  return url.toString();
}

async function getSentinelAccessToken(endpoint: EndpointRow) {
  const config = endpoint.config.sentinel;
  if (!config?.tenantId || !config.clientId || !config.clientSecretEncrypted) {
    throw new Error("Microsoft Sentinel endpoint is missing tenant ID, client ID, or client secret.");
  }

  const cloud = sentinelCloudEndpoints(config.azureCloud ?? "public");
  const response = await fetch(`${cloud.authorityHost}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: openTotpSecret(config.clientSecretEncrypted),
      scope: cloud.scope,
    }),
  });

  const body = await response.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description ?? `Microsoft Entra token request failed with HTTP ${response.status}.`);
  }

  return body.access_token;
}

async function deliverSentinel(endpoint: EndpointRow, payload: CanonicalSiemEvent, deliveryId: string) {
  const accessToken = await getSentinelAccessToken(endpoint);
  const body = JSON.stringify([sentinelRecord(payload)]);
  return fetch(sentinelIngestionUrl(endpoint), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "Collie-Sentinel/1.0",
      "x-ms-client-request-id": crypto.randomUUID(),
      "X-Collie-Delivery": deliveryId,
      "X-Collie-Event": payload.type,
    },
    body,
  });
}

function escapeExtension(value: unknown) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("=", "\\=")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function cefPayload(event: CanonicalSiemEvent) {
  const severity = event.type === "submitted" ? 8 : event.type === "clicked" ? 5 : 3;
  const name = titleFor(event);
  const extension = [
    ["rt", event.occurredAt],
    ["cs1Label", "organisation"],
    ["cs1", event.organisation.slug],
    ["cs2Label", "campaign"],
    ["cs2", event.campaign?.name],
    ["suser", event.actor?.email],
    ["msg", event.report?.bodyPreview ?? event.report?.subject ?? name],
    ["request", event.report?.urls?.[0]],
  ]
    .map(([key, value]) => `${key}=${escapeExtension(value)}`)
    .join(" ");

  return `CEF:0|Collie|Collie|1|${event.type}|${escapeExtension(name)}|${severity}|${extension}`;
}

function leefPayload(event: CanonicalSiemEvent) {
  const fields = {
    devTime: event.occurredAt,
    sev: severityFor(event),
    cat: event.type,
    usrName: event.actor?.email ?? "",
    org: event.organisation.slug,
    campaign: event.campaign?.name ?? "",
    subject: event.report?.subject ?? "",
    url: event.report?.urls?.[0] ?? "",
  };
  const extension = Object.entries(fields)
    .map(([key, value]) => `${key}=${escapeExtension(value)}`)
    .join("\t");
  return `LEEF:2.0|Collie|Collie|1.0|${event.type}|\t${extension}`;
}

function payloadBody(endpoint: EndpointRow, event: CanonicalSiemEvent) {
  if (endpoint.format === "cef") {
    return { body: cefPayload(event), contentType: "text/plain; charset=utf-8" };
  }
  if (endpoint.format === "leef") {
    return { body: leefPayload(event), contentType: "text/plain; charset=utf-8" };
  }
  return {
    body: JSON.stringify(jsonPayload(endpoint, event)),
    contentType: "application/json",
  };
}

function signBody(input: { deliveryId: string; body: string; signingKey: string; timestamp: string }) {
  return crypto
    .createHmac("sha256", input.signingKey)
    .update(`${input.timestamp}.${input.deliveryId}.${input.body}`)
    .digest("hex");
}

function retryDelayMs(attemptCount: number) {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function markDeadLetter(input: {
  deliveryId: string;
  endpointId: string;
  organisationId: string;
  reason: string;
  statusCode: number | null;
  error: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}) {
  const now = new Date();
  await db
    .update(outboundDeliveries)
    .set({
      status: "dead_letter",
      attemptCount: input.attemptCount,
      lastAttemptAt: now,
      lastStatusCode: input.statusCode,
      lastError: input.error,
      updatedAt: now,
    })
    .where(eq(outboundDeliveries.id, input.deliveryId));
  await db
    .insert(outboundDeadLetters)
    .values({
      organisationId: input.organisationId,
      endpointId: input.endpointId,
      deliveryId: input.deliveryId,
      reason: input.reason,
      lastStatusCode: input.statusCode,
      lastError: input.error,
      payload: input.payload,
    })
    .onConflictDoNothing();
  await db
    .update(outboundEndpoints)
    .set({ lastFailureAt: now, updatedAt: now })
    .where(eq(outboundEndpoints.id, input.endpointId));
}

export async function deliverSiemSoarDelivery(deliveryId: string): Promise<DeliveryOutcome> {
  const [row] = await db
    .select({
      deliveryId: outboundDeliveries.id,
      status: outboundDeliveries.status,
      attemptCount: outboundDeliveries.attemptCount,
      payload: outboundDeliveries.payload,
      endpointId: outboundEndpoints.id,
      endpointOrganisationId: outboundEndpoints.organisationId,
      endpointName: outboundEndpoints.name,
      endpointConnector: outboundEndpoints.connector,
      endpointFormat: outboundEndpoints.format,
      endpointUrl: outboundEndpoints.url,
      endpointConfig: outboundEndpoints.config,
      endpointEnabled: outboundEndpoints.enabled,
      endpointEventTypes: outboundEndpoints.eventTypes,
      endpointMaxAttempts: outboundEndpoints.maxAttempts,
      organisationId: organisations.id,
      signingKeyEncrypted: organisations.siemSoarSigningKeyEncrypted,
    })
    .from(outboundDeliveries)
    .innerJoin(outboundEndpoints, eq(outboundEndpoints.id, outboundDeliveries.endpointId))
    .innerJoin(organisations, eq(organisations.id, outboundDeliveries.organisationId))
    .where(eq(outboundDeliveries.id, deliveryId))
    .limit(1);

  if (!row) {
    return { status: "skipped", deliveryId, reason: "Delivery was not found." };
  }

  if (row.status === "succeeded" || row.status === "dead_letter") {
    return { status: "skipped", deliveryId, reason: `Delivery is already ${row.status}.` };
  }

  const endpoint: EndpointRow = {
    id: row.endpointId,
    organisationId: row.endpointOrganisationId,
    name: row.endpointName,
    connector: row.endpointConnector,
    format: row.endpointFormat,
    url: row.endpointUrl,
    config: row.endpointConfig ?? {},
    enabled: row.endpointEnabled,
    eventTypes: row.endpointEventTypes,
    maxAttempts: row.endpointMaxAttempts,
  };
  const payload = row.payload as CanonicalSiemEvent;
  const attemptCount = row.attemptCount + 1;

  if (!endpoint.enabled) {
    await markDeadLetter({
      deliveryId,
      endpointId: endpoint.id,
      organisationId: row.organisationId,
      reason: "Endpoint is disabled.",
      statusCode: null,
      error: "Endpoint is disabled.",
      payload,
      attemptCount,
    });
    return { status: "dead_letter", deliveryId, reason: "Endpoint is disabled." };
  }

  let statusCode: number | null = null;
  let errorText = "";

  try {
    const response =
      endpoint.connector === "sentinel"
        ? await deliverSentinel(endpoint, payload, deliveryId)
        : await deliverSignedWebhook(endpoint, payload, deliveryId, row.signingKeyEncrypted);
    statusCode = response.status;

    if (response.ok) {
      const now = new Date();
      await db
        .update(outboundDeliveries)
        .set({
          status: "succeeded",
          attemptCount,
          lastAttemptAt: now,
          deliveredAt: now,
          lastStatusCode: statusCode,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(outboundDeliveries.id, deliveryId));
      await db
        .update(outboundEndpoints)
        .set({ lastSuccessAt: now, updatedAt: now })
        .where(eq(outboundEndpoints.id, endpoint.id));

      return { status: "succeeded", deliveryId };
    }

    errorText = (await response.text().catch(() => "")).slice(0, 2000);
  } catch (error) {
    errorText = error instanceof Error ? error.message : "Network error";
  }

  const error = errorText || `HTTP ${statusCode ?? "network"} delivery failure`;

  if (attemptCount >= Math.max(1, endpoint.maxAttempts)) {
    await markDeadLetter({
      deliveryId,
      endpointId: endpoint.id,
      organisationId: row.organisationId,
      reason: "Maximum delivery attempts exhausted.",
      statusCode,
      error,
      payload,
      attemptCount,
    });
    return { status: "dead_letter", deliveryId, reason: error };
  }

  const now = new Date();
  const retryAt = new Date(now.getTime() + retryDelayMs(attemptCount));
  const nextStatus: DeliveryStatus = "retrying";
  await db
    .update(outboundDeliveries)
    .set({
      status: nextStatus,
      attemptCount,
      nextAttemptAt: retryAt,
      lastAttemptAt: now,
      lastStatusCode: statusCode,
      lastError: error,
      updatedAt: now,
    })
    .where(eq(outboundDeliveries.id, deliveryId));
  await db
    .update(outboundEndpoints)
    .set({ lastFailureAt: now, updatedAt: now })
    .where(eq(outboundEndpoints.id, endpoint.id));

  return { status: "retrying", deliveryId, retryAt };
}

async function deliverSignedWebhook(
  endpoint: EndpointRow,
  payload: CanonicalSiemEvent,
  deliveryId: string,
  signingKeyEncrypted: string | null,
) {
  const signingKey = signingKeyEncrypted
    ? openTotpSecret(signingKeyEncrypted)
    : (await ensureOrganisationSiemSoarSigningKey(endpoint.organisationId)).key;
  const { body, contentType } = payloadBody(endpoint, payload);
  const timestamp = new Date().toISOString();
  const signature = signBody({ deliveryId, body, signingKey, timestamp });

  return fetch(endpoint.url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "User-Agent": "Collie-SIEM-SOAR/1.0",
      "X-Collie-Delivery": deliveryId,
      "X-Collie-Endpoint": endpoint.id,
      "X-Collie-Event": payload.type,
      "X-Collie-Timestamp": timestamp,
      "X-Collie-Signature-256": `sha256=${signature}`,
    },
    body,
  });
}

export async function listDueSiemSoarDeliveryIds(limit = 100) {
  const rows = await db
    .select({ id: outboundDeliveries.id })
    .from(outboundDeliveries)
    .where(
      sql`${outboundDeliveries.status} in ('pending', 'retrying') and (${outboundDeliveries.nextAttemptAt} is null or ${outboundDeliveries.nextAttemptAt} <= now())`,
    )
    .orderBy(outboundDeliveries.createdAt)
    .limit(limit);

  return rows.map((row) => row.id);
}

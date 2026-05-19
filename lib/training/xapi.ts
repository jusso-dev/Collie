import { and, eq, or, sql } from "drizzle-orm";

import { openTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  emailTemplates,
  employees,
  landingPages,
  organisations,
  trainingAssignments,
  trainingModules,
} from "@/lib/db/schema";

export type TrainingLifecycleEvent = "assigned" | "started" | "completed" | "passed";

export type XapiActor = {
  email?: string | null;
  name?: string | null;
  accountName?: string | null;
  accountHomePage?: string | null;
};

export type XapiTrainingModule = {
  id: string;
  title: string;
  description: string;
  topic: string;
  durationSeconds?: number | null;
};

export type XapiStatementInput = {
  eventType: TrainingLifecycleEvent;
  actor: XapiActor;
  module: XapiTrainingModule;
  organisationId: string;
  activityBaseUrl: string;
  timestamp?: Date;
  registration?: string;
  score?: {
    raw: number;
    min?: number;
    max?: number;
    scaled?: number;
  };
  metadata?: Record<string, unknown>;
};

export type LrsConfig = {
  endpointUrl: string;
  username: string;
  password: string;
};

// ADL does not publish literal "assigned" or "started" verb IDs; use the
// closest ADL lifecycle verbs while keeping Collie's event name in extensions.
export const ADL_XAPI_VERBS: Record<TrainingLifecycleEvent, { id: string; display: string }> = {
  assigned: { id: "http://adlnet.gov/expapi/verbs/registered", display: "registered" },
  started: { id: "http://adlnet.gov/expapi/verbs/initialized", display: "initialized" },
  completed: { id: "http://adlnet.gov/expapi/verbs/completed", display: "completed" },
  passed: { id: "http://adlnet.gov/expapi/verbs/passed", display: "passed" },
};

function actorFor(input: XapiActor) {
  const name = input.name?.trim() || undefined;
  const email = input.email?.trim().toLowerCase();

  if (email) {
    return {
      objectType: "Agent",
      name,
      mbox: `mailto:${email}`,
    };
  }

  return {
    objectType: "Agent",
    name,
    account: {
      homePage: input.accountHomePage ?? "https://collie.local",
      name: input.accountName ?? name ?? "unknown",
    },
  };
}

function isoDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}${remainingSeconds > 0 || safeSeconds === 0 ? `${remainingSeconds}S` : ""}`;
}

function statementEndpoint(endpointUrl: string) {
  const endpoint = new URL(endpointUrl);
  if (!endpoint.pathname.replace(/\/$/, "").endsWith("/statements")) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/statements`;
  }
  return endpoint.toString();
}

function activityIdFor(baseUrl: string, moduleId: string) {
  return `${baseUrl.replace(/\/$/, "")}/training/${encodeURIComponent(moduleId)}`;
}

export function buildXapiStatement(input: XapiStatementInput) {
  const verb = ADL_XAPI_VERBS[input.eventType];
  const timestamp = input.timestamp ?? new Date();
  const completion = input.eventType === "completed" || input.eventType === "passed";
  const success = input.eventType === "passed" ? true : undefined;
  const extensions = {
    "https://collie.app/xapi/extensions/training-event": input.eventType,
    ...(input.metadata ?? {}),
  };

  return {
    id: crypto.randomUUID(),
    version: "1.0.3",
    timestamp: timestamp.toISOString(),
    actor: actorFor(input.actor),
    verb: {
      id: verb.id,
      display: { "en-US": verb.display },
    },
    object: {
      id: activityIdFor(input.activityBaseUrl, input.module.id),
      objectType: "Activity",
      definition: {
        name: { "en-US": input.module.title },
        description: { "en-US": input.module.description },
        type: "http://adlnet.gov/expapi/activities/course",
      },
    },
    result:
      completion || input.score
        ? {
            ...(completion ? { completion: true } : {}),
            ...(success !== undefined ? { success } : {}),
            ...(input.module.durationSeconds ? { duration: isoDuration(input.module.durationSeconds) } : {}),
            ...(input.score
              ? {
                  score: {
                    raw: input.score.raw,
                    min: input.score.min ?? 0,
                    max: input.score.max ?? 100,
                    ...(input.score.scaled !== undefined ? { scaled: input.score.scaled } : {}),
                  },
                }
              : {}),
          }
        : undefined,
    context: {
      ...(input.registration ? { registration: input.registration } : {}),
      contextActivities: {
        grouping: [
          {
            id: `${input.activityBaseUrl.replace(/\/$/, "")}/organisations/${encodeURIComponent(input.organisationId)}`,
            objectType: "Activity",
          },
        ],
      },
      extensions,
    },
  };
}

export async function sendXapiStatement(config: LrsConfig, statement: ReturnType<typeof buildXapiStatement>) {
  const auth = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
  const response = await fetch(statementEndpoint(config.endpointUrl), {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "X-Experience-API-Version": "1.0.3",
    },
    body: JSON.stringify(statement),
  });

  if (!response.ok) {
    throw new Error(`LRS rejected xAPI statement with ${response.status} ${response.statusText}`);
  }

  return { ok: true, status: response.status };
}

export async function getLrsConfigForOrganisation(organisationId: string): Promise<LrsConfig | null> {
  const [row] = await db
    .select({
      enabled: organisations.lrsEnabled,
      endpointUrl: organisations.lrsEndpointUrl,
      usernameEncrypted: organisations.lrsUsernameEncrypted,
      passwordEncrypted: organisations.lrsPasswordEncrypted,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);

  if (!row?.enabled || !row.endpointUrl || !row.usernameEncrypted || !row.passwordEncrypted) {
    return null;
  }

  return {
    endpointUrl: row.endpointUrl,
    username: openTotpSecret(row.usernameEncrypted),
    password: openTotpSecret(row.passwordEncrypted),
  };
}

export async function emitTrainingLifecycleStatement(input: XapiStatementInput) {
  const config = await getLrsConfigForOrganisation(input.organisationId);
  if (!config) {
    return { ok: false as const, skipped: true as const, reason: "lrs_not_configured" };
  }

  const statement = buildXapiStatement(input);
  await sendXapiStatement(config, statement);
  return { ok: true as const, statementId: statement.id };
}

export async function emitTrainingAssignmentStatement(input: {
  assignmentId: string;
  eventType: TrainingLifecycleEvent;
  activityBaseUrl: string;
  score?: XapiStatementInput["score"];
  metadata?: Record<string, unknown>;
}) {
  const [row] = await db
    .select({
      assignmentId: trainingAssignments.id,
      organisationId: employees.organisationId,
      employeeId: employees.id,
      email: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      moduleId: trainingModules.id,
      title: trainingModules.title,
      description: trainingModules.description,
      topic: trainingModules.topic,
      durationSeconds: trainingModules.durationSeconds,
    })
    .from(trainingAssignments)
    .innerJoin(employees, eq(employees.id, trainingAssignments.employeeId))
    .innerJoin(trainingModules, eq(trainingModules.id, trainingAssignments.trainingModuleId))
    .where(eq(trainingAssignments.id, input.assignmentId))
    .limit(1);

  if (!row) {
    return { ok: false as const, skipped: true as const, reason: "assignment_not_found" };
  }

  return emitTrainingLifecycleStatement({
    eventType: input.eventType,
    organisationId: row.organisationId,
    activityBaseUrl: input.activityBaseUrl,
    registration: row.assignmentId,
    actor: {
      email: row.email,
      name: `${row.firstName} ${row.lastName}`.trim(),
      accountName: row.employeeId,
    },
    module: {
      id: row.moduleId,
      title: row.title,
      description: row.description,
      topic: row.topic,
      durationSeconds: row.durationSeconds,
    },
    score: input.score,
    metadata: input.metadata,
  });
}

export async function emitCampaignTargetTrainingCompletion(input: {
  campaignTargetId: string;
  activityBaseUrl: string;
  metadata?: Record<string, unknown>;
}) {
  const [row] = await db
    .select({
      targetId: campaignTargets.id,
      organisationId: campaigns.organisationId,
      employeeId: employees.id,
      email: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      landingTrainingModuleId: landingPages.linkedTrainingModuleId,
      templateTrainingModuleId: emailTemplates.linkedTrainingModuleId,
    })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .leftJoin(landingPages, eq(landingPages.id, campaigns.landingPageId))
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .where(eq(campaignTargets.id, input.campaignTargetId))
    .limit(1);

  const moduleId = row?.landingTrainingModuleId ?? row?.templateTrainingModuleId ?? null;
  if (!row || !moduleId) {
    return { ok: false as const, skipped: true as const, reason: "training_module_not_found" };
  }

  const [module] = await db
    .select({
      id: trainingModules.id,
      title: trainingModules.title,
      description: trainingModules.description,
      topic: trainingModules.topic,
      durationSeconds: trainingModules.durationSeconds,
    })
    .from(trainingModules)
    .where(
      and(
        eq(trainingModules.id, moduleId),
        or(eq(trainingModules.organisationId, row.organisationId), sql`${trainingModules.organisationId} is null`),
      ),
    )
    .limit(1);

  if (!module) {
    return { ok: false as const, skipped: true as const, reason: "training_module_not_found" };
  }

  return emitTrainingLifecycleStatement({
    eventType: "completed",
    organisationId: row.organisationId,
    activityBaseUrl: input.activityBaseUrl,
    registration: row.targetId,
    actor: {
      email: row.email,
      name: `${row.firstName} ${row.lastName}`.trim(),
      accountName: row.employeeId,
    },
    module,
    metadata: {
      source: "campaign_training_completion",
      ...(input.metadata ?? {}),
    },
  });
}

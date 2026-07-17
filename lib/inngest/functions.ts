import { NonRetriableError } from "inngest";

import {
  listDispatchTargetIds,
  PermanentSendError,
  runCampaignTargetSend,
  sendCampaignById,
  sendCampaignTargetById,
} from "@/lib/campaigns/send-campaign";
import { purgeExpiredAuditLogs } from "@/lib/audit/purge";
import { runEventRetention } from "@/lib/compliance/event-retention";
import { inngest } from "@/lib/inngest/client";
import { deliverSiemSoarDelivery, listDueSiemSoarDeliveryIds } from "@/lib/integrations/siem-soar";
import { calculateRiskScore } from "@/lib/risk/scoring";

/**
 * Legacy "fire one Inngest event for the whole campaign / single target"
 * entry point. Preserved for backwards compatibility with code paths that
 * still emit the old `campaign.send` event. New launches should emit
 * `campaign/launch.requested` and let `campaignDispatch` fan out per-target
 * events.
 */
export const campaignSend = inngest.createFunction(
  {
    id: "campaign-send",
    name: "Campaign send (legacy)",
    retries: 3,
    triggers: [{ event: "campaign.send" }],
  },
  async ({ event, step }) => {
    const result = await step.run("send-campaign-email", async () => {
      const { campaignId, organisationId } = event.data as {
        campaignId?: string;
        organisationId?: string;
      };

      if (!campaignId || !organisationId) {
        throw new NonRetriableError(
          "Scheduled campaign send is missing campaignId or organisationId.",
        );
      }

      if (typeof event.data.targetId === "string") {
        return sendCampaignTargetById({ campaignId, organisationId, targetId: event.data.targetId });
      }

      return sendCampaignById({ campaignId, organisationId });
    });

    return { sent: true, ...result };
  },
);

/**
 * Dispatcher: triggered by `campaign/launch.requested`. Loads every unsent
 * target for the campaign and emits one `campaign/target.send.requested`
 * event per target. Inngest's runtime handles parallelism, ordering, and
 * worker-restart durability.
 */
export const campaignDispatch = inngest.createFunction(
  {
    id: "campaign-dispatch",
    name: "Campaign dispatch (fan-out)",
    retries: 3,
    triggers: [{ event: "campaign/launch.requested" }],
  },
  async ({ event, step, logger }) => {
    const { campaignId, organisationId } = event.data as {
      campaignId?: string;
      organisationId?: string;
    };

    if (!campaignId || !organisationId) {
      throw new NonRetriableError(
        "campaign/launch.requested is missing campaignId or organisationId.",
      );
    }

    const targetIds = await step.run("load-unsent-targets", async () =>
      listDispatchTargetIds({ organisationId, campaignId }),
    );

    if (targetIds.length === 0) {
      logger.info("No unsent targets for campaign", { campaignId, organisationId });
      return { campaignId, fanout: 0 };
    }

    // Chunk to keep individual `sendEvent` payloads under the Inngest batch
    // limit. 500 is a comfortable margin and still produces a single step
    // per chunk for a 5k-target campaign.
    const CHUNK_SIZE = 500;
    for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
      const chunk = targetIds.slice(i, i + CHUNK_SIZE);
      await step.sendEvent(
        `fanout-${i}`,
        chunk.map((targetId) => ({
          name: "campaign/target.send.requested",
          data: { campaignId, organisationId, targetId },
        })),
      );
    }

    return { campaignId, fanout: targetIds.length };
  },
);

/**
 * Per-target worker: triggered by `campaign/target.send.requested`. Runs the
 * tz/working-hours clamp and Resend send. On deferral, sleeps until the next
 * allowed window then retries the same logic in this run. On retriable
 * failure, Inngest applies exponential backoff via the function-level
 * `retries` setting.
 */
export const campaignSendTarget = inngest.createFunction(
  {
    id: "campaign-send-target",
    name: "Campaign send (per target)",
    retries: 6,
    triggers: [{ event: "campaign/target.send.requested" }],
    // Per-org concurrency cap so a 5k-target campaign doesn't melt Resend.
    concurrency: [
      {
        scope: "account",
        key: "event.data.organisationId",
        limit: 25,
      },
    ],
  },
  async ({ event, step, logger }) => {
    const { campaignId, organisationId, targetId } = event.data as {
      campaignId?: string;
      organisationId?: string;
      targetId?: string;
    };

    if (!campaignId || !organisationId || !targetId) {
      throw new NonRetriableError(
        "campaign/target.send.requested is missing campaignId, organisationId, or targetId.",
      );
    }

    // Up to two in-run deferrals when the working-hours window pushes the send
    // a short way into the future. After that, hand back to Inngest as a
    // re-enqueued event so the worker isn't tied up for days.
    const MAX_IN_RUN_DEFERRALS = 2;
    const SHORT_DEFER_MS = 6 * 60 * 60 * 1000; // 6h

    for (let attempt = 0; attempt <= MAX_IN_RUN_DEFERRALS; attempt += 1) {
      const outcome = await step.run(`send-attempt-${attempt}`, async () => {
        try {
          return await runCampaignTargetSend({ campaignId, organisationId, targetId });
        } catch (error) {
          if (error instanceof PermanentSendError) {
            // Permanent failure (4xx). Don't burn Inngest retries.
            throw new NonRetriableError(
              `Resend permanent failure (${error.statusCode}): ${error.message}`,
            );
          }
          throw error;
        }
      });

      if (outcome.status === "sent" || outcome.status === "skipped") {
        return outcome;
      }

      // outcome.status === "deferred"
      const deferUntil = new Date(outcome.deferUntil);
      const delayMs = deferUntil.getTime() - Date.now();

      if (delayMs <= SHORT_DEFER_MS && attempt < MAX_IN_RUN_DEFERRALS) {
        logger.info("Target deferred; sleeping then retrying", { targetId, deferUntil });
        await step.sleepUntil(`defer-${attempt}`, deferUntil);
        continue;
      }

      // Long defer (weekend / after-hours): re-enqueue so this worker is
      // freed and Inngest schedules the resume durably.
      await step.sendEvent(`re-enqueue-${attempt}`, {
        name: "campaign/target.send.requested",
        data: { campaignId, organisationId, targetId },
        ts: deferUntil.getTime(),
      });
      return { status: "deferred" as const, deferUntil: deferUntil.toISOString() };
    }

    // Unreachable: the loop body always returns.
    return { status: "exhausted" as const };
  },
);

export const riskRecalculateScores = inngest.createFunction(
  {
    id: "risk-recalculate-scores",
    name: "Risk: recalculate scores",
    retries: 1,
    triggers: [{ cron: "TZ=Australia/Sydney 0 2 * * *" }],
  },
  async ({ step }) => {
    const baseline = await step.run("calculate-baseline-score", async () =>
      calculateRiskScore({
        clicksLast180Days: 0,
        submissionsLast180Days: 0,
        reportsLast180Days: 0,
        trainingsCompletedLast180Days: 0,
      }),
    );

    return { checked: true, baseline };
  },
);

export const eventRetentionSweep = inngest.createFunction(
  {
    id: "event-retention-sweep",
    name: "Compliance: event retention sweep",
    retries: 1,
    triggers: [{ cron: "TZ=Australia/Sydney 30 2 * * *" }],
  },
  async ({ step }) => {
    return step.run("scrub-expired-event-pii", async () => runEventRetention());
  },
);

export const auditLogRetentionPurge = inngest.createFunction(
  {
    id: "audit-log-retention-purge",
    name: "Compliance: audit log retention purge",
    retries: 1,
    triggers: [{ cron: "TZ=Australia/Sydney 0 3 * * *" }],
  },
  async ({ step }) => {
    return step.run("purge-expired-audit-rows", async () => purgeExpiredAuditLogs());
  },
);

export const siemSoarDeliver = inngest.createFunction(
  {
    id: "siem-soar-deliver",
    name: "SIEM/SOAR deliver",
    retries: 0,
    triggers: [{ event: "siem-soar/delivery.requested" }],
    concurrency: [
      {
        scope: "account",
        key: "event.data.deliveryId",
        limit: 1,
      },
    ],
  },
  async ({ event, step }) => {
    const { deliveryId } = event.data as { deliveryId?: string };

    if (!deliveryId) {
      throw new NonRetriableError("siem-soar/delivery.requested is missing deliveryId.");
    }

    const result = await step.run("deliver", async () => deliverSiemSoarDelivery(deliveryId));

    if (result.status === "retrying") {
      await step.sendEvent("schedule-retry", {
        name: "siem-soar/delivery.requested",
        data: { deliveryId },
        ts: new Date(result.retryAt).getTime(),
      });
    }

    return result;
  },
);

export const siemSoarSweepDueDeliveries = inngest.createFunction(
  {
    id: "siem-soar-sweep-due-deliveries",
    name: "SIEM/SOAR sweep due deliveries",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const deliveryIds = await step.run("list-due-deliveries", async () =>
      listDueSiemSoarDeliveryIds(100),
    );

    if (deliveryIds.length > 0) {
      await step.sendEvent(
        "enqueue-due-deliveries",
        deliveryIds.map((deliveryId) => ({
          name: "siem-soar/delivery.requested",
          data: { deliveryId },
        })),
      );
    }

    return { queued: deliveryIds.length };
  },
);

export const functions = [
  campaignSend,
  campaignDispatch,
  campaignSendTarget,
  riskRecalculateScores,
  eventRetentionSweep,
  auditLogRetentionPurge,
  siemSoarDeliver,
  siemSoarSweepDueDeliveries,
];

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { campaignTargets, employees, events, eventType } from "@/lib/db/schema";
import { enqueueSimulationEventPush } from "@/lib/integrations/siem-soar";
import { issueTrainingCertificateForTarget } from "@/lib/training/certificates";
import { emitCampaignTargetTrainingCompletion } from "@/lib/training/xapi";

type EventType = (typeof eventType.enumValues)[number];

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

type CampaignTargetRow = NonNullable<
  Awaited<ReturnType<typeof db.query.campaignTargets.findFirst>>
>;

export type EventSuppressionDecision = {
  suppress: boolean;
  metadataPatch?: Record<string, unknown>;
};

export async function recordTrackingEvent(input: {
  token: string;
  eventType: EventType;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Called after the campaign target is loaded but before any writes.
   * When the returned `suppress` is true, the event row is still
   * inserted (so the bot/MPP hit stays visible for forensics) but
   * `campaignTargets.openedAt` / `clickedAt` / etc. are NOT updated and
   * the SIEM/SOAR push is skipped. Used by the pixel and click routes
   * to keep Apple MPP prefetches and security-gateway scanners out of
   * dashboard counts. See `lib/tracking/bot-detection.ts`.
   */
  suppressionDecision?: (target: CampaignTargetRow) => EventSuppressionDecision;
}) {
  try {
    const now = new Date();
    const target = await db.query.campaignTargets.findFirst({
      where: eq(campaignTargets.uniqueToken, input.token),
    });

    if (!target) {
      return null;
    }

    const decision = input.suppressionDecision?.(target) ?? { suppress: false };
    const mergedMetadata = {
      ...(input.metadata ?? {}),
      ...(decision.metadataPatch ?? {}),
    };

    const [event] = await db
      .insert(events)
      .values({
        campaignTargetId: target.id,
        eventType: input.eventType,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: mergedMetadata,
        createdAt: now,
      })
      .returning({ id: events.id });

    const timestampUpdate = decision.suppress
      ? null
      : input.eventType === "opened"
        ? { openedAt: target.openedAt ?? now }
        : input.eventType === "clicked"
          ? { clickedAt: target.clickedAt ?? now }
          : input.eventType === "submitted"
            ? { submittedAt: target.submittedAt ?? now }
            : input.eventType === "reported"
              ? { reportedAt: target.reportedAt ?? now }
              : input.eventType === "trained"
                ? { trainingCompletedAt: target.trainingCompletedAt ?? now }
                : null;

    if (timestampUpdate) {
      await db
        .update(campaignTargets)
        .set({ ...timestampUpdate, updatedAt: now })
        .where(eq(campaignTargets.id, target.id));
    }

    if (input.eventType === "trained") {
      await db
        .update(employees)
        .set({ lastTrainedAt: target.trainingCompletedAt ?? now, updatedAt: now })
        .where(eq(employees.id, target.employeeId));

      await issueTrainingCertificateForTarget({
        campaignTargetId: target.id,
        completedAt: target.trainingCompletedAt ?? now,
      });

      try {
        await emitCampaignTargetTrainingCompletion({
          campaignTargetId: target.id,
          activityBaseUrl: appUrl(),
          metadata: input.metadata,
        });
      } catch (error) {
        console.warn("xAPI training completion could not be emitted", error);
      }
    }

    if (event && !decision.suppress) {
      try {
        await enqueueSimulationEventPush(event.id);
      } catch (error) {
        console.warn("SIEM/SOAR push could not be queued for tracking event", error);
      }
    }

    return target;
  } catch (error) {
    console.warn("Tracking event could not be recorded", error);
    return null;
  }
}

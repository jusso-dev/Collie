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

export async function recordTrackingEvent(input: {
  token: string;
  eventType: EventType;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const now = new Date();
    const target = await db.query.campaignTargets.findFirst({
      where: eq(campaignTargets.uniqueToken, input.token),
    });

    if (!target) {
      return null;
    }

    const [event] = await db
      .insert(events)
      .values({
        campaignTargetId: target.id,
        eventType: input.eventType,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata ?? {},
        createdAt: now,
      })
      .returning({ id: events.id });

    const timestampUpdate =
      input.eventType === "opened"
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

    if (event) {
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

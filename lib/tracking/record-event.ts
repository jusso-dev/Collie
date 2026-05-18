import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { campaignTargets, events, eventType } from "@/lib/db/schema";

type EventType = (typeof eventType.enumValues)[number];

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

    await db.insert(events).values({
      campaignTargetId: target.id,
      eventType: input.eventType,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: input.metadata ?? {},
      createdAt: now,
    });

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

    return target;
  } catch (error) {
    console.warn("Tracking event could not be recorded", error);
    return null;
  }
}

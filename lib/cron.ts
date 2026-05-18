import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import cron from "node-cron";

import { sendCampaignTargetById } from "@/lib/campaigns/send-campaign";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns } from "@/lib/db/schema";

type CronTask = ReturnType<typeof cron.schedule>;

const globalTasksKey = "__collie_cron_tasks__" as const;
const campaignSchedulerJob = {
  name: "Campaign schedule",
  pattern: "* * * * *",
};

function getTaskMap(): Map<string, CronTask> {
  const global = globalThis as unknown as Record<string, Map<string, CronTask>>;
  if (!global[globalTasksKey]) {
    global[globalTasksKey] = new Map();
  }
  return global[globalTasksKey];
}

export async function processDueCampaignTargets(limit = 100) {
  const now = new Date();
  const dueTargets = await db
    .select({
      campaignId: campaigns.id,
      organisationId: campaigns.organisationId,
      targetId: campaignTargets.id,
    })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .where(
      and(
        isNull(campaignTargets.sentAt),
        or(eq(campaigns.status, "scheduled"), eq(campaigns.status, "running")),
        or(
          lte(campaignTargets.scheduledAt, now),
          and(isNull(campaignTargets.scheduledAt), lte(campaigns.startAt, now)),
        ),
        sql`${campaigns.scheduleCron} is null or ${campaigns.scheduleCron} <> ''`,
      ),
    )
    .limit(limit);

  let sent = 0;
  const errors: string[] = [];

  for (const target of dueTargets) {
    try {
      const result = await sendCampaignTargetById(target);
      sent += result.sentCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${target.targetId}: ${message}`);
      console.error(`[cron] Campaign target send failed: ${message}`);
    }
  }

  return { checked: dueTargets.length, sent, errors };
}

export function startCronJobs() {
  const tasks = getTaskMap();

  if (tasks.has(campaignSchedulerJob.name)) {
    console.log("[cron] Background jobs already registered");
    return;
  }

  const task = cron.schedule(campaignSchedulerJob.pattern, () => {
    void processDueCampaignTargets();
  });

  tasks.set(campaignSchedulerJob.name, task);
  console.log(`[cron] Background jobs registered: campaign-schedule (${campaignSchedulerJob.pattern})`);
}

import { inngest } from "@/lib/inngest/client";
import { sendCampaignById, sendCampaignTargetById } from "@/lib/campaigns/send-campaign";
import { calculateRiskScore } from "@/lib/risk/scoring";

export const campaignSend = inngest.createFunction(
  { id: "campaign-send", triggers: [{ event: "campaign.send" }] },
  async ({ event, step }) => {
    const result = await step.run("send-campaign-email", async () => {
      const { campaignId, organisationId } = event.data as {
        campaignId?: string;
        organisationId?: string;
      };

      if (!campaignId || !organisationId) {
        throw new Error("Scheduled campaign send is missing campaignId or organisationId.");
      }

      if (typeof event.data.targetId === "string") {
        return sendCampaignTargetById({ campaignId, organisationId, targetId: event.data.targetId });
      }

      return sendCampaignById({ campaignId, organisationId });
    });

    return { sent: true, ...result };
  },
);

export const riskRecalculateScores = inngest.createFunction(
  { id: "risk-recalculate-scores", triggers: [{ cron: "TZ=Australia/Sydney 0 2 * * *" }] },
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

export const functions = [campaignSend, riskRecalculateScores];

import cron from "node-cron";

import { sendStrategy } from "@/lib/db/schema";

type SendStrategy = (typeof sendStrategy.enumValues)[number];

export function cronPatternForDate(date: Date) {
  return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
}

export function isValidCampaignCron(value: string | null | undefined): value is string {
  return Boolean(value && cron.validate(value));
}

export function nextCampaignCronRun(value: string | null | undefined) {
  if (!isValidCampaignCron(value)) return null;

  const task = cron.createTask(value, () => undefined);
  const nextRun = task.getNextRun();
  task.destroy();
  return nextRun;
}

export function scheduledTargetTime(input: {
  index: number;
  total: number;
  strategy: SendStrategy;
  startAt: Date;
  endAt: Date | null;
}) {
  const startMs = input.startAt.getTime();
  const endMs = input.endAt?.getTime() ?? startMs;
  const windowMs = Math.max(0, endMs - startMs);

  if (input.strategy === "immediate" || windowMs === 0) {
    return input.startAt;
  }

  const offset =
    input.strategy === "drip"
      ? Math.round((windowMs / Math.max(1, input.total - 1)) * input.index)
      : Math.floor(Math.random() * windowMs);

  return new Date(startMs + offset);
}

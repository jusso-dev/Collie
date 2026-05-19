import cron from "node-cron";

import { sendStrategy } from "@/lib/db/schema";

type SendStrategy = (typeof sendStrategy.enumValues)[number];

export type WorkingWindow = {
  startMinute: number;
  endMinute: number;
  allowedIsoDays: number[];
};

export const DEFAULT_WORKING_WINDOW: WorkingWindow = {
  startMinute: 540,
  endMinute: 1020,
  allowedIsoDays: [1, 2, 3, 4, 5],
};

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

const ISO_WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isoWeekday: number;
  minuteOfDay: number;
};

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);
  const isoWeekday = ISO_WEEKDAYS[map.weekday] ?? 1;
  return { year, month, day, hour, minute, second, isoWeekday, minuteOfDay: hour * 60 + minute };
}

function offsetMinutes(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
}

function zoneToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = offsetMinutes(guess, timeZone);
  const adjusted = new Date(guess.getTime() - offset * 60000);
  const offsetAfter = offsetMinutes(adjusted, timeZone);
  if (offsetAfter !== offset) {
    return new Date(guess.getTime() - offsetAfter * 60000);
  }
  return adjusted;
}

export function isInsideWorkingWindow(candidate: Date, timeZone: string, window: WorkingWindow): boolean {
  const parts = partsInZone(candidate, timeZone);
  if (!window.allowedIsoDays.includes(parts.isoWeekday)) return false;
  return parts.minuteOfDay >= window.startMinute && parts.minuteOfDay < window.endMinute;
}

export function nextAllowedSendTime(candidate: Date, timeZone: string, window: WorkingWindow): Date {
  if (window.allowedIsoDays.length === 0) return candidate;
  if (window.endMinute <= window.startMinute) return candidate;

  const hour = Math.floor(window.startMinute / 60);
  const minute = window.startMinute % 60;
  let cursor = candidate;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const parts = partsInZone(cursor, timeZone);
    if (!window.allowedIsoDays.includes(parts.isoWeekday)) {
      cursor = zoneToUtc(parts.year, parts.month, parts.day + 1, hour, minute, timeZone);
      continue;
    }
    if (parts.minuteOfDay < window.startMinute) {
      cursor = zoneToUtc(parts.year, parts.month, parts.day, hour, minute, timeZone);
      continue;
    }
    if (parts.minuteOfDay >= window.endMinute) {
      cursor = zoneToUtc(parts.year, parts.month, parts.day + 1, hour, minute, timeZone);
      continue;
    }
    return cursor;
  }
  return cursor;
}

export function scheduledTargetTime(input: {
  index: number;
  total: number;
  strategy: SendStrategy;
  startAt: Date;
  endAt: Date | null;
  timeZone?: string | null;
  window?: WorkingWindow | null;
}) {
  const startMs = input.startAt.getTime();
  const endMs = input.endAt?.getTime() ?? startMs;
  const windowMs = Math.max(0, endMs - startMs);

  let candidate: Date;
  if (input.strategy === "immediate" || windowMs === 0) {
    candidate = input.startAt;
  } else {
    const offset =
      input.strategy === "drip"
        ? Math.round((windowMs / Math.max(1, input.total - 1)) * input.index)
        : Math.floor(Math.random() * windowMs);
    candidate = new Date(startMs + offset);
  }

  if (input.timeZone && input.window) {
    return nextAllowedSendTime(candidate, input.timeZone, input.window);
  }
  return candidate;
}

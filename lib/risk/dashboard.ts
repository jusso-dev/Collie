import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  employees,
  events,
  industryBenchmarks,
  organisations,
  riskScoreHistory,
} from "@/lib/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_WINDOWS = [30, 90, 180] as const;

export type CohortSort = "riskDeltaDesc" | "riskDeltaAsc";

type OrganisationBenchmarkInput = {
  id: string;
};

type EmployeeRow = {
  id: string;
  active: boolean;
  riskScore: number;
  department: string | null;
  managerEmail: string | null;
  timezone: string;
};

type TargetRow = {
  targetId: string;
  employeeId: string;
  sentAt: Date | null;
  clickedAt: Date | null;
  submittedAt: Date | null;
  reportedAt: Date | null;
  trainingCompletedAt: Date | null;
};

type HistoryRow = {
  employeeId: string;
  score: number;
  calculatedAt: Date;
};

export type RiskDashboardData = Awaited<ReturnType<typeof getRiskDashboardData>>;

export function parseCohortSort(value: string | string[] | undefined): CohortSort {
  return value === "riskDeltaAsc" ? "riskDeltaAsc" : "riskDeltaDesc";
}

function round(value: number, places = 1) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function percentage(numerator: number, denominator: number) {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((total, item) => total + item.weight, 0);
  if (totalWeight === 0) return null;
  return round(values.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight);
}

function normaliseBenchmarkKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "all";
}

function inferEmployeeCountBand(employeeCount: number) {
  if (employeeCount <= 50) return "1-50";
  if (employeeCount <= 200) return "51-200";
  if (employeeCount <= 1000) return "201-1000";
  if (employeeCount <= 5000) return "1001-5000";
  return "5000+";
}

function inferRegion(timezone: string | null | undefined) {
  if (!timezone) return "No region";
  const [region] = timezone.split("/");
  return region || "No region";
}

function isWithin(date: Date | null, cutoff: Date) {
  return Boolean(date && date.getTime() >= cutoff.getTime());
}

function scoreAt(history: HistoryRow[], cutoff: Date) {
  let score: number | null = null;

  for (const point of history) {
    if (point.calculatedAt.getTime() <= cutoff.getTime()) {
      score = point.score;
    }
  }

  return score;
}

function buildCampaignRows(rows: Array<TargetRow & { campaignId: string; campaignName: string; status: string }>) {
  const campaignMap = new Map<
    string,
    {
      id: string;
      name: string;
      status: string;
      targets: number;
      clicked: number;
      reported: number;
    }
  >();

  for (const row of rows) {
    const campaign = campaignMap.get(row.campaignId) ?? {
      id: row.campaignId,
      name: row.campaignName,
      status: row.status,
      targets: 0,
      clicked: 0,
      reported: 0,
    };

    campaign.targets += 1;
    campaign.clicked += row.clickedAt ? 1 : 0;
    campaign.reported += row.reportedAt ? 1 : 0;
    campaignMap.set(row.campaignId, campaign);
  }

  return Array.from(campaignMap.values()).map((campaign) => ({
    ...campaign,
    clickRate: percentage(campaign.clicked, campaign.targets),
    reportRate: percentage(campaign.reported, campaign.targets),
  }));
}

export async function getRiskDashboardData(organisation: OrganisationBenchmarkInput, cohortSort: CohortSort) {
  const now = new Date();
  const cutoffs = Object.fromEntries(
    TREND_WINDOWS.map((days) => [days, new Date(now.getTime() - days * DAY_MS)]),
  ) as Record<(typeof TREND_WINDOWS)[number], Date>;

  const [organisationRows, employeeRows, targetRows, eventRows, historyRows, benchmarkRows] = await Promise.all([
    db
      .select({
        industry: organisations.industry,
        employeeCountBand: organisations.employeeCountBand,
      })
      .from(organisations)
      .where(eq(organisations.id, organisation.id))
      .limit(1),
    db
      .select({
        id: employees.id,
        active: employees.active,
        riskScore: employees.riskScore,
        department: employees.department,
        managerEmail: employees.managerEmail,
        timezone: employees.timezone,
      })
      .from(employees)
      .where(eq(employees.organisationId, organisation.id)),
    db
      .select({
        targetId: campaignTargets.id,
        employeeId: campaignTargets.employeeId,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        status: campaigns.status,
        sentAt: campaignTargets.sentAt,
        clickedAt: campaignTargets.clickedAt,
        submittedAt: campaignTargets.submittedAt,
        reportedAt: campaignTargets.reportedAt,
        trainingCompletedAt: campaignTargets.trainingCompletedAt,
      })
      .from(campaignTargets)
      .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
      .where(eq(campaigns.organisationId, organisation.id)),
    db
      .select({
        employeeId: campaignTargets.employeeId,
        createdAt: events.createdAt,
      })
      .from(events)
      .innerJoin(campaignTargets, eq(campaignTargets.id, events.campaignTargetId))
      .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
      .where(eq(campaigns.organisationId, organisation.id)),
    db
      .select({
        employeeId: riskScoreHistory.employeeId,
        score: riskScoreHistory.score,
        calculatedAt: riskScoreHistory.calculatedAt,
      })
      .from(riskScoreHistory)
      .innerJoin(employees, eq(employees.id, riskScoreHistory.employeeId))
      .where(eq(employees.organisationId, organisation.id))
      .orderBy(riskScoreHistory.calculatedAt),
    db
      .select({
        industry: industryBenchmarks.industry,
        employeeCountBand: industryBenchmarks.employeeCountBand,
        medianPpp: industryBenchmarks.medianPpp,
        sampleSize: industryBenchmarks.sampleSize,
        calculatedAt: industryBenchmarks.calculatedAt,
      })
      .from(industryBenchmarks),
  ]);
  const organisationProfile = organisationRows[0] ?? { industry: null, employeeCountBand: null };

  const activeEmployees = employeeRows.filter((employee) => employee.active);
  const historyByEmployee = new Map<string, HistoryRow[]>();
  const targetsByEmployee = new Map<string, TargetRow[]>();

  for (const row of historyRows) {
    historyByEmployee.set(row.employeeId, [...(historyByEmployee.get(row.employeeId) ?? []), row]);
  }

  for (const row of targetRows) {
    targetsByEmployee.set(row.employeeId, [...(targetsByEmployee.get(row.employeeId) ?? []), row]);
  }

  const employeeWeight = (employeeId: string) => {
    const recentTargets = (targetsByEmployee.get(employeeId) ?? []).filter((target) =>
      isWithin(target.sentAt, cutoffs[180]),
    ).length;

    return 1 + Math.min(recentTargets, 5) * 0.2;
  };

  const humanRiskScore = weightedAverage(
    activeEmployees.map((employee) => ({
      value: employee.riskScore,
      weight: employeeWeight(employee.id),
    })),
  );

  const trend = TREND_WINDOWS.map((days) => {
    const cutoff = cutoffs[days];
    const baselineScores = activeEmployees
      .map((employee) => {
        const baseline = scoreAt(historyByEmployee.get(employee.id) ?? [], cutoff);
        return baseline === null ? null : { value: baseline, weight: employeeWeight(employee.id) };
      })
      .filter((item): item is { value: number; weight: number } => item !== null);
    const baselineScore = weightedAverage(baselineScores);
    const eventCount = eventRows.filter((event) => event.createdAt.getTime() >= cutoff.getTime()).length;

    return {
      days,
      baselineScore,
      currentScore: humanRiskScore,
      delta: humanRiskScore === null || baselineScore === null ? null : round(humanRiskScore - baselineScore),
      eventCount,
    };
  });

  const sentTargets = targetRows.filter((target) => target.sentAt);
  const phishProneTargets = sentTargets.filter((target) => target.clickedAt || target.submittedAt);
  const orgPpp = percentage(phishProneTargets.length, sentTargets.length);
  const benchmarkBand = organisationProfile.employeeCountBand ?? inferEmployeeCountBand(activeEmployees.length);
  const industry = normaliseBenchmarkKey(organisationProfile.industry);
  const benchmark =
    benchmarkRows.find(
      (row) => normaliseBenchmarkKey(row.industry) === industry && row.employeeCountBand === benchmarkBand,
    ) ??
    benchmarkRows.find(
      (row) => normaliseBenchmarkKey(row.industry) === "all" && row.employeeCountBand === benchmarkBand,
    ) ??
    null;

  const cohortBuckets = new Map<string, { type: string; value: string; employees: EmployeeRow[] }>();
  const addCohort = (type: string, value: string, employee: EmployeeRow) => {
    const key = `${type}:${value}`;
    const bucket = cohortBuckets.get(key) ?? { type, value, employees: [] };
    bucket.employees.push(employee);
    cohortBuckets.set(key, bucket);
  };

  for (const employee of activeEmployees) {
    addCohort("Department", employee.department?.trim() || "No department", employee);
    addCohort("Manager", employee.managerEmail?.trim() || "No manager", employee);
    addCohort("Region", inferRegion(employee.timezone), employee);
    addCohort("Timezone", employee.timezone || "No timezone", employee);
  }

  const cohortRows = Array.from(cohortBuckets.values()).map((bucket) => {
    const employeeIds = new Set(bucket.employees.map((employee) => employee.id));
    const bucketTargets = targetRows.filter((target) => employeeIds.has(target.employeeId));
    const bucketSent = bucketTargets.filter((target) => target.sentAt);
    const bucketPhishProne = bucketSent.filter((target) => target.clickedAt || target.submittedAt);
    const bucketReported = bucketSent.filter((target) => target.reportedAt);
    const bucketEventsLast90 = eventRows.filter(
      (event) => employeeIds.has(event.employeeId) && event.createdAt.getTime() >= cutoffs[90].getTime(),
    ).length;
    const baselineScores = bucket.employees
      .map((employee) => scoreAt(historyByEmployee.get(employee.id) ?? [], cutoffs[90]))
      .filter((score): score is number => score !== null);
    const currentRisk = average(bucket.employees.map((employee) => employee.riskScore));
    const baselineRisk = average(baselineScores);

    return {
      type: bucket.type,
      value: bucket.value,
      employeeCount: bucket.employees.length,
      averageRisk: currentRisk,
      riskDelta90: currentRisk === null || baselineRisk === null ? null : round(currentRisk - baselineRisk),
      sentTargets: bucketSent.length,
      ppp: percentage(bucketPhishProne.length, bucketSent.length),
      reportRate: percentage(bucketReported.length, bucketSent.length),
      eventsLast90: bucketEventsLast90,
    };
  });

  const direction = cohortSort === "riskDeltaAsc" ? 1 : -1;
  cohortRows.sort((a, b) => {
    if (a.riskDelta90 === null && b.riskDelta90 === null) return b.employeeCount - a.employeeCount;
    if (a.riskDelta90 === null) return 1;
    if (b.riskDelta90 === null) return -1;
    return (a.riskDelta90 - b.riskDelta90) * direction;
  });

  const activeEmployeeIds = new Set(activeEmployees.map((employee) => employee.id));
  const activeTargetRows = targetRows.filter((target) => activeEmployeeIds.has(target.employeeId));
  const clicked = activeTargetRows.filter((target) => target.clickedAt).length;
  const submitted = activeTargetRows.filter((target) => target.submittedAt).length;
  const reported = activeTargetRows.filter((target) => target.reportedAt).length;
  const trained = activeTargetRows.filter((target) => target.trainingCompletedAt).length;
  const campaignRows = buildCampaignRows(targetRows);

  return {
    employees: {
      total: employeeRows.length,
      active: activeEmployees.length,
    },
    humanRiskScore,
    trend,
    outcomes: {
      targets: activeTargetRows.length,
      clickRate: percentage(clicked, activeTargetRows.length),
      submitRate: percentage(submitted, activeTargetRows.length),
      reportRate: percentage(reported, activeTargetRows.length),
      trainingCompleteRate: percentage(trained, activeTargetRows.length),
      orgPpp,
    },
    benchmark: benchmark
      ? {
          industry: benchmark.industry,
          employeeCountBand: benchmark.employeeCountBand,
          medianPpp: benchmark.medianPpp,
          sampleSize: benchmark.sampleSize,
          delta: orgPpp === null ? null : orgPpp - benchmark.medianPpp,
        }
      : null,
    cohorts: cohortRows,
    campaigns: campaignRows,
  };
}

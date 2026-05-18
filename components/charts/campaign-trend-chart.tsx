"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TrendPoint = {
  week: string;
  click: number;
  report: number;
  trained: number;
};

export function CampaignTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-lg border border-dashed border-border bg-[var(--collie-cloud)] px-6 text-center">
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          No trend data yet. Launch a campaign and complete training to start building a 90 day view.
        </p>
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: -20, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(100 116 139 / 0.18)" />
          <XAxis dataKey="week" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--card-foreground)",
            }}
          />
          <Line type="monotone" dataKey="click" stroke="var(--collie-orange)" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="report" stroke="var(--collie-water)" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="trained" stroke="var(--collie-navy)" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

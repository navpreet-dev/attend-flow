"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { DashboardPayload } from "@/lib/types";
import { parsePortalDate } from "@/lib/af-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingUp, BarChart3 } from "lucide-react";

const EMERALD = "#10b981";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";

function shortDate(ddmmyyyy: string): string {
  const m = ddmmyyyy.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (!m) return ddmmyyyy;
  return `${m[1]}/${m[2]}`;
}

export function TrendsCharts({ data, threshold }: { data: DashboardPayload; threshold: number }) {
  // ---- Daily stacked bars (present vs absent) + cumulative % line ----------
  const daily = useMemo(() => {
    const byDate = new Map<string, { present: number; absent: number }>();
    for (const l of data.logs) {
      const entry = byDate.get(l.date) ?? { present: 0, absent: 0 };
      if (l.status === "PRESENT") entry.present += 1;
      else entry.absent += 1;
      byDate.set(l.date, entry);
    }
    const dates = Array.from(byDate.keys()).sort((a, b) => parsePortalDate(a) - parsePortalDate(b));
    const rows: { date: string; Present: number; Absent: number; Cumulative: number }[] = [];
    let attendedCum = 0;
    let totalCum = 0;
    for (const d of dates) {
      const e = byDate.get(d)!;
      attendedCum += e.present;
      totalCum += e.present + e.absent;
      rows.push({
        date: shortDate(d),
        Present: e.present,
        Absent: e.absent,
        Cumulative: totalCum > 0 ? Math.round((attendedCum / totalCum) * 1000) / 10 : 0,
      });
    }
    return rows;
  }, [data.logs]);

  // ---- Per-subject horizontal bars ----------------------------------------
  const bySubject = useMemo(
    () =>
      [...data.subjects]
        .sort((a, b) => a.percentage - b.percentage)
        .map((s) => ({
          name: s.subjectName.length > 18 ? s.subjectName.slice(0, 17) + "…" : s.subjectName,
          fullName: s.subjectName,
          Percentage: s.percentage,
          fill:
            s.percentage < threshold ? ROSE : s.percentage < threshold + 5 ? AMBER : EMERALD,
        })),
    [data.subjects, threshold]
  );

  const hasLogs = daily.length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Daily classes &amp; cumulative attendance
          </CardTitle>
          <CardDescription>
            Every lecture recorded on the portal, oldest to newest. The line is your
            overall percentage over time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasLogs ? (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} domain={[0, "dataMax + 2"]} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    domain={[0, 100]}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: 12 }}
                    formatter={(value, name) => [value, name]}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={threshold}
                    stroke={AMBER}
                    strokeDasharray="6 4"
                    label={{ value: `${threshold}% target`, fontSize: 11, position: "insideTopRight" }}
                  />
                  <Bar yAxisId="left" dataKey="Present" stackId="a" fill={EMERALD} radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="left" dataKey="Absent" stackId="a" fill={ROSE} radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="Cumulative"
                    stroke="#0ea5a4"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              No class logs recorded on the portal yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Subject-wise percentage
          </CardTitle>
          <CardDescription>Lowest attendance first — fix the red ones.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[Math.max(220, bySubject.length * 36)]px w-full" style={{ height: Math.max(220, bySubject.length * 38) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySubject} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12 }}
                  formatter={(value: number | string) => [`${value}%`, "Attendance"]}
                />
                <ReferenceLine x={threshold} stroke={AMBER} strokeDasharray="6 4" />
                <Bar dataKey="Percentage" radius={[0, 6, 6, 0]} barSize={18}>
                  {bySubject.map((entry) => (
                    <Cell key={entry.fullName} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

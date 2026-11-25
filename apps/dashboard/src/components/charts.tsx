import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { KpiClassDaily, KpiStudentDaily, OrgOverviewPoint } from '../data/types';
import { dayLabel, formatNumber } from '../lib/format';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--foreground)',
} as const;

const axis = {
  tick: { fill: 'var(--muted-foreground)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export function ActiveMinutesChart({ daily }: { daily: KpiStudentDaily[] }) {
  const data = daily.map((row) => ({ day: dayLabel(row.day), minutes: Number(row.active_minutes) }));
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" {...axis} minTickGap={18} />
          <YAxis {...axis} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${String(value)} min`, 'Active minutes']} />
          <Bar dataKey="minutes" fill="var(--chart-1)" radius={[5, 5, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ClassDailyChart({ daily }: { daily: KpiClassDaily[] }) {
  const data = daily.map((row) => ({
    day: dayLabel(row.day),
    students: row.active_students,
    minutes: Number(row.avg_active_minutes),
  }));
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" {...axis} minTickGap={18} />
          <YAxis {...axis} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Line type="monotone" dataKey="students" name="Active students" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="minutes" name="Avg active minutes" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrgOverviewChart({ points }: { points: OrgOverviewPoint[] }) {
  const data = points.map((row) => ({
    day: dayLabel(row.day),
    students: row.activeStudents,
    minutes: row.avgActiveMinutes,
  }));
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" {...axis} minTickGap={18} />
          <YAxis {...axis} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="students" name="Active students" fill="var(--chart-2)" radius={[5, 5, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MasteryBar({ value, label: text }: { value: number | null; label: string }) {
  const pct = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row-between small">
        <span style={{ fontWeight: 600 }}>{text}</span>
        <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {pct === null ? 'No data' : `${formatNumber(pct)}%`}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label={`${text} mastery`}
        style={{ height: 8, borderRadius: 999, background: 'var(--secondary)', overflow: 'hidden' }}
      >
        {pct !== null ? (
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 999,
              background: pct >= 75 ? 'var(--chart-1)' : pct >= 50 ? 'var(--chart-3)' : 'var(--destructive)',
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

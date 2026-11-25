import type { ReactNode } from 'react';
import { label } from '../lib/format';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="btn-row">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {title || actions ? (
        <div className="card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="btn-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label: statLabel, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{statLabel}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

export function Field({
  label: fieldLabel,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{fieldLabel}</label>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? (
        <span className="field-hint" role="alert" style={{ color: 'var(--destructive)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty" role="status">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <div className="row-between">
        <span>{message}</span>
        {onRetry ? (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="loading" role="status" aria-busy="true">
      {text}
    </div>
  );
}

type BadgeTone = 'green' | 'amber' | 'red' | 'blue' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : `badge-${tone}`}`}>{children}</span>;
}

const VERDICT_TONE: Record<string, BadgeTone> = {
  ACCEPTED: 'green',
  WRONG_ANSWER: 'red',
  COMPILE_ERROR: 'amber',
  RUNTIME_ERROR: 'amber',
  TIME_LIMIT_EXCEEDED: 'amber',
  MEMORY_LIMIT_EXCEEDED: 'amber',
  OUTPUT_LIMIT_EXCEEDED: 'amber',
  JUDGE_UNAVAILABLE: 'blue',
  SUBMISSION_FAILED: 'red',
};

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <Badge>Pending</Badge>;
  return <Badge tone={VERDICT_TONE[verdict] ?? 'neutral'}>{label(verdict)}</Badge>;
}

export function LateBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">—</span>;
  const tone: BadgeTone = status === 'ON_TIME' ? 'green' : status === 'LATE' ? 'red' : 'amber';
  return <Badge tone={tone}>{label(status)}</Badge>;
}

export function RecheckBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === 'NOT_REQUIRED') return <span className="muted">Not required</span>;
  const tone: BadgeTone = status === 'DONE' ? 'green' : status === 'FAILED' ? 'red' : status === 'RUNNING' ? 'blue' : 'amber';
  const text = status === 'QUEUED' ? 'Pending' : status === 'DONE' ? 'Checked' : label(status);
  return <Badge tone={tone}>{text}</Badge>;
}

export function FlagBadge({ flag }: { flag: string }) {
  return <Badge tone={flag === 'HIGH_PASTE' ? 'amber' : flag === 'MANY_FOCUS_LOSS' ? 'red' : 'blue'}>{label(flag)}</Badge>;
}

export function SourceView({ source, label: heading }: { source: string; label?: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  return (
    <pre className="source-code" aria-label={heading ?? 'Source code'} tabIndex={0}>
      {lines.map((line, index) => (
        <div className="source-line" key={index}>
          <span className="ln" aria-hidden="true">
            {index + 1}
          </span>
          <span className="lc">{line || ' '}</span>
        </div>
      ))}
    </pre>
  );
}

export function TableWrap({ children, label: caption }: { children: ReactNode; label?: string }) {
  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-error" role="alert">
      {children}
    </div>
  );
}

export function InlineSuccess({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-success" role="status">
      {children}
    </div>
  );
}

export function InlineInfo({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-info" role="status">
      {children}
    </div>
  );
}

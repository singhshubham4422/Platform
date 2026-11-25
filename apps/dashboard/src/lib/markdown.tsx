import type { ReactNode } from 'react';

type Token = { type: 'text' | 'code' | 'strong' | 'em' | 'link'; value: string; href?: string };

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: 'text', value: text.slice(last, index) });
    const raw = match[0];
    if (raw.startsWith('`')) tokens.push({ type: 'code', value: raw.slice(1, -1) });
    else if (raw.startsWith('**')) tokens.push({ type: 'strong', value: raw.slice(2, -2) });
    else if (raw.startsWith('*')) tokens.push({ type: 'em', value: raw.slice(1, -1) });
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(raw);
      if (link && /^https?:\/\//i.test(link[2] ?? '')) tokens.push({ type: 'link', value: link[1] ?? '', href: link[2] });
      else tokens.push({ type: 'text', value: raw });
    }
    last = index + raw.length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'code':
        return <code key={key}>{token.value}</code>;
      case 'strong':
        return <strong key={key}>{token.value}</strong>;
      case 'em':
        return <em key={key}>{token.value}</em>;
      case 'link':
        return (
          <a key={key} href={token.href} target="_blank" rel="noopener noreferrer">
            {token.value}
          </a>
        );
      default:
        return <span key={key}>{token.value}</span>;
    }
  });
}

/**
 * Tiny allow-list Markdown renderer for question statements. It never uses
 * dangerouslySetInnerHTML and never renders raw HTML from the source.
 */
export function Markdown({ source }: { source: string }) {
  if (!source.trim()) return <p className="muted">No statement yet.</p>;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: { lines: string[]; lang: string } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ');
    out.push(<p key={`p-${out.length}`}>{inline(text, `p-${out.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={`li-${index}`}>{inline(item, `li-${out.length}-${index}`)}</li>);
    out.push(list.ordered ? <ol key={`l-${out.length}`}>{items}</ol> : <ul key={`l-${out.length}`}>{items}</ul>);
    list = null;
  };

  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) {
        out.push(
          <pre key={`c-${out.length}`} className="code-block">
            <code>{code.lines.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      code = { lines: [], lang: line.slice(3).trim() };
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1]?.length ?? 1);
      const content = inline(heading[2] ?? '', `h-${out.length}`);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      out.push(<Tag key={`h-${out.length}`}>{content}</Tag>);
      continue;
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    const unordered = /^[-*]\s+(.*)$/.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((ordered ?? unordered)?.[1] ?? '');
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (list) flushList();
    paragraph.push(line.trim());
  }
  if (code) {
    out.push(
      <pre key={`c-${out.length}`} className="code-block">
        <code>{code.lines.join('\n')}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();
  return <div className="markdown">{out}</div>;
}

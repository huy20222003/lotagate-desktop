import { ChevronRight } from 'lucide-react';
import { Icon } from './ui/Icon.js';

const SEGMENT_LABELS: Record<string, string> = {
  settings: 'Settings',
  'api-key': 'API key',
  'keyboard-shortcuts': 'Keyboard shortcuts',
  hook: 'Hooks',
  skill: 'Skills',
  plugin: 'Plugins',
  mcp: 'MCP',
  'computer-use': 'Computer Use',
};

export function Breadcrumb({ path, currentHeading = false, onNavigate, labels }: { path: string; currentHeading?: boolean; onNavigate?: (path: string) => void; labels?: Readonly<Record<string, string>> }) {
  const segments = path.split(/[\\/]+/u).filter(Boolean);
  return <nav className="breadcrumb" aria-label="Breadcrumb"><ol>{segments.map((segment, index) => { const label = labels?.[segment] ?? SEGMENT_LABELS[segment] ?? humanizeSegment(segment); const current = index === segments.length - 1; const Tag = current && currentHeading ? 'h1' : 'span'; const segmentPath = segments.slice(0, index + 1).join('/'); return <li key={`${segment}-${index}`}>{index > 0 ? <Icon icon={ChevronRight} size={14} /> : null}{onNavigate !== undefined && !current ? <button type="button" className="breadcrumb-link" onClick={() => onNavigate(segmentPath)}>{label}</button> : <Tag aria-current={current ? 'page' : undefined}>{label}</Tag>}</li>; })}</ol></nav>;
}

function humanizeSegment(segment: string): string {
  return segment.split(/[-_]+/u).filter(Boolean).map(word => `${word.slice(0, 1).toLocaleUpperCase()}${word.slice(1)}`).join(' ');
}

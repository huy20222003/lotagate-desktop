import type { CSSProperties } from 'react';
import { Tooltip } from '../../../components/ui.js';
import { contextUsagePercent, formatContextTokenCount, type ContextWindowUsage } from '../context-window-usage.js';

export function ContextWindowUsageIndicator({ usage }: { usage: ContextWindowUsage }) {
  const percent = contextUsagePercent(usage);
  const tooltip = <span className="context-window-tooltip">
    <span className="context-window-tooltip-heading"><span>Context window:</span><strong>{percent}% full</strong></span>
    <span>{formatContextTokenCount(usage.usedTokens)} / {formatContextTokenCount(usage.contextWindow)} tokens used</span>
  </span>;
  return <Tooltip label={tooltip}><span className="context-window-usage-indicator" role="img" aria-label={`${percent}% of context window used`}><span className="context-window-usage-ring" style={{ '--context-window-usage': `${percent}%` } as CSSProperties}><span /></span></span></Tooltip>;
}

import type { ReactElement } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return <TooltipPrimitive.Provider delayDuration={0}><TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="ui-tooltip-content" sideOffset={7}>{label}</TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root></TooltipPrimitive.Provider>;
}

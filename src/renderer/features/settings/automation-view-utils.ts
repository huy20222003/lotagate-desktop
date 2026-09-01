import type { Automation } from '../../../contracts/ipc/v1/automation.js';
import { formatTime } from '../../utils/time.js';

export function automationScheduleLabel(automation: Automation): string {
  const schedule = automation.schedule;
  if (schedule.kind === 'manual') return 'Manual only';
  if (schedule.kind === 'once') return `Once · ${formatTime(schedule.at, { dateStyle: 'medium', timeStyle: 'short' })}`;
  if (schedule.kind === 'interval') return `Every ${schedule.everyMinutes} min`;
  if (schedule.kind === 'daily') return `Daily at ${schedule.time}`;
  if (schedule.kind === 'weekly') return `Weekly · ${schedule.time}`;
  return `Cron · ${schedule.expression}`;
}

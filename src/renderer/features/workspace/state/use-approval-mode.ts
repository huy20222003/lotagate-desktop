import { useCallback, useEffect, useState } from 'react';
import type { ApprovalMode } from './approval-policy.js';

export function useApprovalMode(): [ApprovalMode, (next: ApprovalMode) => void] {
  const [mode, setMode] = useState<ApprovalMode>('auto');
  useEffect(() => { void window.lotagate.settings.get().then(settings => setMode(settings.approvalMode)).catch(() => undefined); }, []);
  const update = useCallback((next: ApprovalMode) => {
    setMode(next);
    void window.lotagate.settings.update({ approvalMode: next }).catch(() => undefined);
  }, []);
  return [mode, update];
}

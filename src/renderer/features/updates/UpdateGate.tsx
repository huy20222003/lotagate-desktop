import { useEffect, useState } from 'react';
import type { DesktopUpdateSnapshot } from '../../../contracts/ipc/v1/update.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { DesktopUpdatePanel } from './DesktopUpdatePanel.js';

export function UpdateGate({ snapshot, onContinue }: { snapshot: DesktopUpdateSnapshot; onContinue?: () => void }) {
  const [current, setCurrent] = useState(snapshot);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => window.lotagate.updates.onState(setCurrent), []);
  return <main className="app-loading app-update-gate"><DesktopUpdatePanel snapshot={error === undefined ? current : { ...current, phase: 'error', error }} onCheck={() => { setError(undefined); void window.lotagate.updates.check().then(setCurrent).catch(reason => setError(toUserErrorMessage(reason))); }} onDownload={() => { setError(undefined); void window.lotagate.updates.download().then(setCurrent).catch(reason => setError(toUserErrorMessage(reason))); }} onInstall={() => { setError(undefined); void window.lotagate.updates.install().then(setCurrent).catch(reason => setError(toUserErrorMessage(reason))); }} {...(current.blocking || onContinue === undefined ? {} : { onContinue })} /></main>;
}

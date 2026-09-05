import { useEffect, useState } from 'react';
import logo from '../../assets/lotagate.png';
import type { DesktopAppVersionInfo, DesktopUpdateSnapshot } from '../../../contracts/ipc/v1/update.js';
import { Card, useToast } from '../../components/ui.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { DesktopUpdatePanel } from '../updates/DesktopUpdatePanel.js';

const initialSnapshot: DesktopUpdateSnapshot = { phase: 'checking', currentVersion: '', platform: 'WINDOWS', architecture: 'X64', release: null, asset: null, blocking: false, bytesDownloaded: 0, totalBytes: null, downloadedFileName: null, error: null };

export function AboutPage() {
  const [info, setInfo] = useState<DesktopAppVersionInfo>();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState<string>();
  const { success, info: showInfo, error: showToastError } = useToast();
  useEffect(() => {
    let active = true;
    void Promise.all([window.lotagate.updates.getInfo(), window.lotagate.updates.getState()]).then(([nextInfo, nextState]) => { if (active) { setInfo(nextInfo); setSnapshot(nextState); } }).catch(reason => { if (active) setError(toUserErrorMessage(reason)); });
    const unsubscribe = window.lotagate.updates.onState(nextState => { if (active) setSnapshot(nextState); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const check = () => { setError(undefined); void window.lotagate.updates.check().then(nextSnapshot => { setSnapshot(nextSnapshot); notifyCheckResult(nextSnapshot); }).catch(reason => { const message = toUserErrorMessage(reason); setError(message); showToastError('Update check failed', message); }); };
  const download = () => { setError(undefined); void window.lotagate.updates.download().then(setSnapshot).catch(reason => setError(toUserErrorMessage(reason))); };
  const install = () => { setError(undefined); void window.lotagate.updates.install().then(setSnapshot).catch(reason => setError(toUserErrorMessage(reason))); };
  const notifyCheckResult = (nextSnapshot: DesktopUpdateSnapshot) => {
    if (nextSnapshot.phase === 'up-to-date') { success('You are up to date'); return; }
    if (nextSnapshot.phase === 'available') { showInfo('A new version is available', nextSnapshot.release === null ? undefined : `Latest version ${nextSnapshot.release.version}`); return; }
    if (nextSnapshot.phase === 'disabled') { showInfo('Updates are disabled in development'); return; }
    if (nextSnapshot.phase === 'unavailable') { showInfo('No compatible update is available', nextSnapshot.error ?? undefined); return; }
    if (nextSnapshot.phase === 'error') showToastError('Update check failed', nextSnapshot.error ?? undefined);
  };
  return <div className="about-page"><div className="about-identity"><img className="about-logo" src={logo} alt="" /><h2>{info?.productName ?? 'LotaGate Desktop'}</h2><p>{info?.version ? `Version ${info.version}` : ''}</p></div><Card className="about-card"><DesktopUpdatePanel {...(info === undefined ? {} : { info })} snapshot={error === undefined ? snapshot : { ...snapshot, phase: 'error', error }} onCheck={check} onDownload={download} onInstall={install} /></Card></div>;
}

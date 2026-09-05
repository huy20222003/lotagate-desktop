import { Download, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import type { DesktopAppVersionInfo, DesktopUpdateSnapshot } from '../../../contracts/ipc/v1/update.js';
import { Button, Icon, Spinner } from '../../components/ui.js';
import { useLocale } from '../../i18n/locale.js';

export function DesktopUpdatePanel({ info, snapshot, onCheck, onDownload, onInstall, onContinue }: { info?: DesktopAppVersionInfo; snapshot: DesktopUpdateSnapshot; onCheck?: () => void; onDownload: () => void; onInstall: () => void; onContinue?: () => void }) {
  const { t } = useLocale();
  const release = snapshot.release;
  const progress = snapshot.totalBytes === null || snapshot.totalBytes === 0 ? null : Math.min(100, Math.round(snapshot.bytesDownloaded / snapshot.totalBytes * 100));
  const title = snapshot.blocking ? t('updateRequired') : snapshot.phase === 'available' || snapshot.phase === 'ready' || snapshot.phase === 'installing' ? t('updateAvailable') : snapshot.phase === 'up-to-date' ? t('updateUpToDate') : snapshot.phase === 'unavailable' ? t('updateUnavailable') : snapshot.phase === 'error' ? t('updateError') : t('checkingForUpdates');
  return <div className="desktop-update-panel">
    <div className="desktop-update-status"><div><h2>{title}</h2><p>{snapshot.error ?? (release?.title ?? '')}{release === null ? '' : ` · ${t('updateLatestVersion')} ${release.version}`}</p></div>{snapshot.blocking ? <Icon icon={ShieldAlert} size={22} /> : null}</div>
    {snapshot.phase === 'checking' ? <Spinner label={t('checkingForUpdates')} /> : null}
    {snapshot.phase === 'downloading' ? <div className="desktop-update-progress"><div className="desktop-update-progress-heading"><span>{t('updateDownloading')}</span><strong>{progress === null ? `${formatBytes(snapshot.bytesDownloaded)}` : `${progress}%`}</strong></div><progress max="100" value={progress ?? 0} /><small>{formatBytes(snapshot.bytesDownloaded)}{snapshot.totalBytes === null ? '' : ` / ${formatBytes(snapshot.totalBytes)}`}</small></div> : null}
    {snapshot.phase === 'ready' ? <p className="settings-status">{t('updateReady')}{snapshot.downloadedFileName === null ? '' : ` · ${snapshot.downloadedFileName}`}</p> : null}
    {release?.releaseNotes && (snapshot.phase === 'available' || snapshot.phase === 'ready') ? <div className="desktop-update-notes"><strong>{t('updateReleaseNotes')}</strong><p>{release.releaseNotes}</p></div> : null}
    {info ? <dl className="desktop-version-details"><div><dt>{t('updateCurrentVersion')}</dt><dd>{info.version}</dd></div><div><dt>{t('updateCliVersion')}</dt><dd>{info.cliVersion ?? '—'}</dd></div><div><dt>{t('updatePlatform')}</dt><dd>{info.platform} · {info.architecture}</dd></div><div><dt>{t('updateElectronVersion')}</dt><dd>{info.electronVersion}</dd></div><div><dt>{t('updateNodeVersion')}</dt><dd>{info.nodeVersion}</dd></div><div><dt>{t('updateApplicationId')}</dt><dd>{info.applicationId}</dd></div><div><dt>{t('updateChannel')}</dt><dd>{info.updateChannel}</dd></div><div><dt>{t('updateInstallMode')}</dt><dd>{info.packaged ? 'Packaged application' : t('updateDisabled')}</dd></div></dl> : null}
    <div className="settings-form-actions">
      {onCheck && (snapshot.phase === 'up-to-date' || snapshot.phase === 'unavailable' || snapshot.phase === 'error' || snapshot.phase === 'disabled') ? <Button variant="secondary" onClick={onCheck}><Icon icon={RefreshCw} size={14} /> {t('checkForUpdates')}</Button> : null}
      {snapshot.phase === 'available' || (snapshot.phase === 'error' && snapshot.release !== null && snapshot.asset !== null) ? <Button variant="primary" onClick={onDownload}><Icon icon={Download} size={14} /> {t('updateDownload')}</Button> : null}
      {snapshot.phase === 'ready' ? <Button variant="primary" onClick={onInstall}><Icon icon={ExternalLink} size={14} /> {t('updateInstall')}</Button> : null}
      {onContinue && !snapshot.blocking && snapshot.phase !== 'downloading' && snapshot.phase !== 'installing' ? <Button variant="ghost" onClick={onContinue}>{t('updateContinue')}</Button> : null}
    </div>
  </div>;
}

function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`; return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`; }

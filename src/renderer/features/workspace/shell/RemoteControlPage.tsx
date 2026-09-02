import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Clock3, Copy, RadioTower, ShieldCheck, Smartphone, Square } from 'lucide-react';
import type { RemoteControlSession } from '../../../../contracts/remote-control/v1/remote-control.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { Button, Card, Icon, useToast } from '../../../components/ui.js';

const STATUS_LABELS: Record<RemoteControlSession['status'], string> = {
  idle: 'Not connected', creating: 'Creating session…', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', offline: 'Offline', expired: 'Expired', revoked: 'Disconnected', error: 'Error',
};
const TERMINAL_STATUSES = new Set<RemoteControlSession['status']>(['expired', 'revoked', 'error']);

export function RemoteControlPage() {
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { success } = useToast();

  useEffect(() => {
    let mounted = true;
    void window.lotagate.remoteControl.get().then(value => { if (mounted) setSession(value); }).catch(reason => { if (mounted) setError(toMessage(reason)); });
    const dispose = window.lotagate.remoteControl.onState(event => { if (mounted) setSession(event.session); });
    return () => { mounted = false; dispose(); };
  }, []);

  useEffect(() => {
    if (!session?.connectUrl) { setQrDataUrl(undefined); return; }
    let mounted = true;
    void QRCode.toDataURL(session.connectUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' }).then(value => { if (mounted) setQrDataUrl(value); }).catch(reason => { if (mounted) setError(toMessage(reason)); });
    return () => { mounted = false; };
  }, [session?.connectUrl]);

  const createSession = async () => {
    setBusy(true); setError(undefined);
    try { setSession(await window.lotagate.remoteControl.create()); success('Remote Control session created'); }
    catch (reason) { setError(toMessage(reason)); }
    finally { setBusy(false); }
  };
  const revokeSession = async () => {
    setBusy(true); setError(undefined);
    try { await window.lotagate.remoteControl.revoke(); success('Remote Control disconnected'); }
    catch (reason) { setError(toMessage(reason)); }
    finally { setBusy(false); }
  };
  const copyLink = async () => { if (!session) return; await navigator.clipboard?.writeText(session.connectUrl); success('Connection link copied'); };
  const activeSession = session !== null && !TERMINAL_STATUSES.has(session.status);

  return <div className="automation-workspace-page remote-control-workspace-page">
    <header className="automation-workspace-header"><div className="automation-workspace-title"><span className="settings-eyebrow">Workspace</span><h1>Remote control</h1></div></header>
    <Scrollbar className="automation-workspace-scrollbar remote-control-workspace-scrollbar"><div className="remote-control-content">
      <div className="remote-control-page-heading"><div><h2>Connect to this Desktop</h2><p>Continue your local sessions from your phone while LotaGate keeps running here.</p></div><div className="remote-control-status"><span className={`remote-control-status-dot status-${session?.status ?? 'idle'}`} /><span>{session ? STATUS_LABELS[session.status] : 'Not connected'}</span></div></div>
      {activeSession && qrDataUrl ? <Card className="remote-control-session-card">
        <div className="remote-control-session-layout"><div className="remote-control-qr-panel"><div className="remote-control-qr"><img src={qrDataUrl} alt="Scan to connect to LotaGate Desktop Remote Control" /></div><span><Smartphone size={14} /> Scan with your phone</span></div><div className="remote-control-session-details"><span className="remote-control-eyebrow">PRIVATE SESSION</span><h2>Ready to connect</h2><p>Scan the QR code with your phone. This link is temporary and only works for this Desktop session.</p><div className="remote-control-link"><code>{session.connectUrl}</code><Button variant="ghost" onClick={() => void copyLink()}><Icon icon={Copy} size={15} /> Copy link</Button></div><div className="remote-control-session-meta"><span><Clock3 size={14} /> Available until {new Date(session.expiresAt).toLocaleString()}</span><span><ShieldCheck size={14} /> Your Desktop remains the execution authority</span></div>{error ? <p className="remote-control-error" role="alert">{error}</p> : null}<div className="remote-control-actions"><Button variant="danger" disabled={busy} onClick={() => void revokeSession()}><Icon icon={Square} size={14} /> End remote session</Button></div></div></div>
      </Card> : <Card className="remote-control-start-card"><div className="remote-control-start-icon"><Icon icon={RadioTower} size={24} /></div><div className="remote-control-start-copy"><span className="remote-control-eyebrow">PRIVATE SESSION</span><h2>{session && TERMINAL_STATUSES.has(session.status) ? 'Session ended' : 'Control your Desktop from anywhere'}</h2><p>{session && TERMINAL_STATUSES.has(session.status) ? 'Create a new temporary session to connect another device.' : 'Start a secure, temporary connection. Your files, tools and agent stay on this Desktop.'}</p></div><div className="remote-control-steps"><span><b>1</b><span>Create a session</span></span><span><b>2</b><span>Scan the QR code</span></span><span><b>3</b><span>Continue on your phone</span></span></div>{error ? <p className="remote-control-error" role="alert">{error}</p> : null}<div className="remote-control-actions"><Button variant="primary" disabled={busy} onClick={() => void createSession()}><Icon icon={session && TERMINAL_STATUSES.has(session.status) ? Check : RadioTower} size={14} /> {busy ? 'Creating…' : 'Create remote session'}</Button></div></Card>}
    </div></Scrollbar>
  </div>;
}

function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'Remote Control operation failed.'; }

import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Card } from '../../../components/ui.js';

export function TrustCard({ request, onDecision }: { request: { path: string }; onDecision: (trusted: boolean) => Promise<void> }): ReactNode {
  return <Card className="trust-card"><div className="approval-heading"><ShieldCheck size={18} /><strong>Trust this project?</strong></div><p>The CLI needs permission to use trusted tools in <code>{request.path}</code>.</p><div className="modal-actions"><Button variant="secondary" onClick={() => void onDecision(false)}>Reject</Button><Button variant="primary" onClick={() => void onDecision(true)}>Trust project</Button></div></Card>;
}

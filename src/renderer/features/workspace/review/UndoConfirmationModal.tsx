import { CHECKPOINT_RETENTION_DAYS } from '../../../../contracts/ipc/v1/workspace.js';
import { Button, Modal } from '../../../components/ui.js';

export function UndoConfirmationModal({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal title="Undo file changes" onClose={() => { if (!busy) onCancel(); }}><p className="modal-copy">Undo all file changes made during this turn?</p><p className="modal-copy">The checkpoint is retained for up to {CHECKPOINT_RETENTION_DAYS} days and is automatically cleaned up afterward.</p><div className="modal-actions"><Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="danger" onClick={onConfirm} disabled={busy}>{busy ? 'Undoing…' : 'Undo'}</Button></div></Modal>;
}

import { useMemo, useState } from 'react';
import { Button, Modal } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { AgentMarkdown } from '../workspace/conversation/markdown-renderer.js';
import type { DesktopHookEvent, ExtensionDetail } from '../../../contracts/ipc/v1/extensions.js';
import type { ExtensionKind, ExtensionRow } from './extension-command-client.js';
import { isRecord, readString } from '../../utils/data.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { HookDetailFields } from './HookDetailFields.js';
import { McpDetailFields } from './McpDetailFields.js';
import { SkillMarkdownEditor } from './SkillMarkdownEditor.js';
import { firstValidationError, parseArgs, parseHook, parseObject, validateContent, validateHookFields, validateMcpFields } from './extensions-validation.js';
import type { ValidationErrors } from './extensions-view-types.js';

type ExtensionDetailKind = Exclude<ExtensionKind, 'plugin'>;

export function ExtensionDetailModal({ kind, cwd, row, detail, onClose, onSaved }: { kind: ExtensionDetailKind; cwd: string; row: ExtensionRow; detail: ExtensionDetail; onClose: () => void; onSaved: () => void }) {
  const initialObject = useMemo(() => parseObject(detail.content), [detail.content]);
  const initialMcpConfig = useMemo(() => isRecord(initialObject?.['config']) ? initialObject['config'] : {}, [initialObject]);
  const [content, setContent] = useState(detail.content);
  const [mcpType, setMcpType] = useState(readString(initialMcpConfig['type']) ?? 'http');
  const [mcpUrl, setMcpUrl] = useState(readString(initialMcpConfig['url']) ?? '');
  const initialHook = useMemo(() => parseHook(initialObject), [initialObject]);
  const [hookEvent, setHookEvent] = useState<DesktopHookEvent>(initialHook.event);
  const [hookCommand, setHookCommand] = useState(initialHook.command);
  const [hookArgs, setHookArgs] = useState(initialHook.args.join(', '));
  const [hookTimeout, setHookTimeout] = useState(String(initialHook.timeoutMs));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const editable = detail.editable;
  const validationErrors: ValidationErrors = !editable ? {} : kind === 'hook' ? validateHookFields(hookCommand, hookArgs, hookTimeout) : kind === 'mcp' ? validateMcpFields(mcpType, mcpUrl) : kind === 'skill' && detail.format === 'markdown' ? validateContent(content) : {};
  const save = async () => { const validationError = firstValidationError(validationErrors); if (validationError !== undefined) { setError(validationError); return; } setSaving(true); setError(undefined); try { const nextContent = kind === 'mcp' ? JSON.stringify({ ...(initialObject ?? {}), config: { ...initialMcpConfig, type: mcpType, url: mcpUrl } }, null, 2) : kind === 'hook' ? JSON.stringify({ event: hookEvent, command: hookCommand, args: parseArgs(hookArgs), timeoutMs: Number(hookTimeout) }, null, 2) : content; await window.lotagate.extensions.writeDetail({ kind, cwd, name: row.name, ...(row.scope === undefined ? {} : { scope: row.scope }), ...(row.pluginName === undefined ? {} : { pluginName: row.pluginName }), ...(row.pluginScope === undefined ? {} : { pluginScope: row.pluginScope }), ...(row.sourceName === undefined ? {} : { sourceName: row.sourceName }), content: nextContent }); onSaved(); } catch (reason) { setError(toMessage(reason)); } finally { setSaving(false); } };
  const subtitle = detail.fileName === undefined ? {} : { subtitle: detail.fileName };
  const skillMarkdown = kind === 'skill' && detail.format === 'markdown';
  return <Modal title={row.name} {...subtitle} className="extension-detail-dialog" onClose={onClose}><Scrollbar className="extension-detail-scrollbar"><div className="extension-detail-modal">{kind === 'mcp' ? <McpDetailFields type={mcpType} url={mcpUrl} errors={validationErrors} editable={editable} onType={setMcpType} onUrl={setMcpUrl} {...(row.scope === undefined ? {} : { scope: row.scope })} /> : kind === 'hook' ? <HookDetailFields event={hookEvent} command={hookCommand} args={hookArgs} timeoutMs={hookTimeout} errors={validationErrors} editable={editable} onEvent={setHookEvent} onCommand={setHookCommand} onArgs={setHookArgs} onTimeout={setHookTimeout} /> : skillMarkdown && editable ? <SkillMarkdownEditor content={content} {...(validationErrors['content'] === undefined ? {} : { error: validationErrors['content'] })} onChange={setContent} /> : skillMarkdown ? <div className="extension-markdown-preview"><AgentMarkdown content={content} /></div> : <pre className="extension-text-preview">{content}</pre>}{error ? <p className="field-error">{error}</p> : null}</div></Scrollbar><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Close</Button>{editable ? <Button variant="primary" disabled={saving || firstValidationError(validationErrors) !== undefined} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button> : null}</div></Modal>;
}

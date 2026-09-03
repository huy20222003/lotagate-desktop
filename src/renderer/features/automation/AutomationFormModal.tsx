import { useEffect, useMemo, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { automationCreateInputSchema, type Automation, type AutomationCreateInput, type AutomationTool } from '../../../contracts/ipc/v1/automation.js';
import type { GitBranch, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Button, Checkbox, Dropdown, Field, Modal, Skeleton, TextArea, TextInput } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { ExtensionCommandClient } from '../../services/extension-command-client.js';
import { extractWorkspaceModels, type WorkspaceModelOption } from '../../services/model-catalog.js';

export interface AutomationFormValue {
  name: string;
  description: string;
  prompt: string;
  workspaceId: string;
  branch: string;
  worktree: boolean;
  model: string;
  skills: string[];
  permissionPolicy: 'ask' | 'allowlist' | 'review' | 'autonomous';
  browserAccess: 'disabled' | 'read-only' | 'interactive' | 'autonomous';
  scheduleKind: 'manual' | 'once' | 'interval' | 'daily' | 'weekly' | 'cron';
  at: string;
  everyMinutes: string;
  startAt: string;
  time: string;
  days: number[];
  cron: string;
  timezone: string;
  maxAttempts: string;
  backoffSeconds: string;
  timeoutMinutes: string;
  notifications: boolean;
  keepSession: boolean;
  tools: AutomationTool[];
}

const TOOL_OPTIONS: Array<{ value: AutomationTool; label: string }> = [
  { value: 'filesystem.read', label: 'Read files' }, { value: 'filesystem.write', label: 'Write files' },
  { value: 'terminal.read', label: 'Read terminal' }, { value: 'terminal.execute', label: 'Run commands' },
  { value: 'git.read', label: 'Read Git' }, { value: 'git.stage', label: 'Stage Git changes' },
  { value: 'git.commit', label: 'Create commits' }, { value: 'git.push', label: 'Push to remote' },
  { value: 'browser.navigate', label: 'Navigate browser' }, { value: 'browser.inspect', label: 'Inspect pages' },
  { value: 'browser.interact', label: 'Interact with pages' }, { value: 'browser.download', label: 'Download browser files' }, { value: 'browser.upload', label: 'Upload browser files' },
  { value: 'artifact.create', label: 'Create artifacts' },
];
const DAY_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function createAutomationFormValue(workspaces: Workspace[], automation?: Automation): AutomationFormValue {
  const schedule = automation?.schedule;
  const scheduleKind = schedule?.kind ?? 'manual';
  const at = schedule?.kind === 'once' ? toLocalDateTime(schedule.at) : '';
  const startAt = schedule?.kind === 'interval' && schedule.startAt ? toLocalDateTime(schedule.startAt) : '';
  return {
    name: automation?.name ?? '', description: automation?.description ?? '', prompt: automation?.prompt ?? '',
    workspaceId: automation?.workspaceId ?? workspaces[0]?.id ?? '', branch: automation?.branch ?? '', worktree: automation?.worktree ?? false,
    model: automation?.model ?? '', skills: automation?.skills ?? [], permissionPolicy: automation?.permissionPolicy ?? 'ask', browserAccess: automation?.browserAccess ?? 'disabled',
    scheduleKind, at, everyMinutes: schedule?.kind === 'interval' ? String(schedule.everyMinutes) : '60', startAt,
    time: schedule && (schedule.kind === 'daily' || schedule.kind === 'weekly') ? schedule.time : '09:00',
    days: schedule?.kind === 'weekly' ? schedule.days : [1], cron: schedule?.kind === 'cron' ? schedule.expression : '0 9 * * 1-5',
    timezone: schedule && schedule.kind !== 'manual' ? schedule.timezone : DEFAULT_TIMEZONE,
    maxAttempts: String(automation?.retryPolicy.maxAttempts ?? 0), backoffSeconds: String(Math.round((automation?.retryPolicy.backoffMs ?? 1_000) / 1_000)),
    timeoutMinutes: String(Math.round((automation?.timeoutMs ?? 60 * 60 * 1_000) / 60_000)), notifications: automation?.notifications ?? true,
    keepSession: automation?.keepSession ?? true, tools: automation?.tools ?? [],
  };
}

export function AutomationFormModal({ workspaces, automation, onClose, onSubmit }: { workspaces: Workspace[]; automation?: Automation; onClose: () => void; onSubmit: (input: AutomationCreateInput) => Promise<void> }) {
  const [value, setValue] = useState(() => createAutomationFormValue(workspaces, automation));
  const [models, setModels] = useState<WorkspaceModelOption[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [skillOptions, setSkillOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const extensionClient = useMemo(() => new ExtensionCommandClient(), []);
  const selectedWorkspace = workspaces.find(workspace => workspace.id === value.workspaceId);
  const textModelOptions = useMemo(() => models.filter(model => model.category === 'text').map(model => ({ value: model.id, label: model.label })), [models]);
  const branchOptions = useMemo(() => [{ value: DEFAULT_BRANCH_OPTION, label: 'Default (HEAD)' }, ...branches.filter(branch => !branch.remote).map(branch => ({ value: branch.name, label: branch.name }))], [branches]);
  const availableSkillOptions = useMemo(() => {
    const options = [...skillOptions];
    for (const skill of value.skills) if (!options.some(option => option.value === skill)) options.push({ value: skill, label: `${skill} (unavailable)` });
    return options;
  }, [skillOptions, value.skills]);
  const update = <K extends keyof AutomationFormValue>(key: K, next: AutomationFormValue[K]) => setValue(current => ({ ...current, [key]: next }));
  useEffect(() => {
    const workspace = selectedWorkspace;
    if (workspace === undefined) { setModels([]); setBranches([]); setSkillOptions([]); return; }
    let active = true;
    setOptionsLoading(true);
    void (async () => {
      try {
        const modelAndSkills = (async () => {
          await window.lotagate.agent.initialize(workspace.rootPath);
          const [modelValue, skillRows] = await Promise.all([window.lotagate.agent.modelList(workspace.rootPath), extensionClient.list(workspace.rootPath, 'skill')]);
          return { models: extractWorkspaceModels(modelValue), skills: skillRows.filter(row => row.status === 'ENABLED').map(row => ({ value: row.name, label: row.name })) };
        })();
        const branchList = Promise.resolve().then(() => window.lotagate.git.branchList(workspace.rootPath));
        const [modelSkillsResult, branchesResult] = await Promise.allSettled([modelAndSkills, branchList]);
        if (!active) return;
        setModels(modelSkillsResult.status === 'fulfilled' ? modelSkillsResult.value.models : []);
        setSkillOptions(modelSkillsResult.status === 'fulfilled' ? modelSkillsResult.value.skills : []);
        setBranches(branchesResult.status === 'fulfilled' ? branchesResult.value : []);
      } catch {
        if (!active) return;
        setModels([]); setSkillOptions([]); setBranches([]);
      } finally {
        if (active) setOptionsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [extensionClient, selectedWorkspace]);
  const input = useMemo(() => buildInput(value), [value]);
  const parsed = automationCreateInputSchema.safeParse(input);
  const validationError = parsed.success ? undefined : parsed.error.issues[0]?.message ?? 'Review the automation settings.';
  const submit = async () => { setSubmitted(true); setError(undefined); if (!parsed.success) return; try { await onSubmit(parsed.data); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save automation.'); } };
  const title = automation ? 'Edit automation' : 'Create automation';
  return <Modal title={title} subtitle="Define what runs, where it runs, and which tools it may use." onClose={onClose} className="automation-form-dialog">
    <Scrollbar className="automation-form-scroll"><div className="automation-form">
      <section className="automation-form-section"><div className="automation-form-heading"><Clock3 size={16} /><div><strong>Workflow</strong><span>The prompt is executed in the selected trusted workspace.</span></div></div>
        <Field label="Name" required><TextInput value={value.name} onChange={event => update('name', event.target.value)} placeholder="Daily project check" autoFocus /></Field>
        <Field label="Description"><TextInput value={value.description} onChange={event => update('description', event.target.value)} placeholder="Short explanation for the team" /></Field>
        <Field label="Instructions" required><TextArea value={value.prompt} onChange={event => update('prompt', event.target.value)} placeholder="Inspect the project, run the checks, and summarize the result." rows={6} /></Field>
        <Field label="Workspace" required><Dropdown value={value.workspaceId} options={workspaces.map(workspace => ({ value: workspace.id, label: workspace.name }))} onChange={next => update('workspaceId', next)} disabled={workspaces.length === 0} /></Field>
        {value.workspaceId && workspaces.find(workspace => workspace.id === value.workspaceId)?.trusted !== true ? <p className="automation-warning">This workspace must be trusted before the automation can run.</p> : null}
        {optionsLoading ? <AutomationOptionsSkeleton /> : <><div className="automation-form-grid"><Field label="Base branch"><Dropdown value={value.branch || DEFAULT_BRANCH_OPTION} options={branchOptions} onChange={next => update('branch', next === DEFAULT_BRANCH_OPTION ? '' : next)} placeholder="Default (HEAD)" /></Field><Field label="Model"><Dropdown value={value.model} options={textModelOptions} onChange={next => update('model', next)} disabled={textModelOptions.length === 0} placeholder="Use workspace default" /></Field></div>
          <Field label="Skills (optional)"><Dropdown multiple value={value.skills} options={availableSkillOptions} onChange={next => update('skills', next)} disabled={availableSkillOptions.length === 0} placeholder="Select skills" /></Field></>}
        <Checkbox label="Use an isolated worktree" checked={value.worktree} onChange={next => update('worktree', next)} />
      </section>

      <section className="automation-form-section"><div className="automation-form-heading"><Clock3 size={16} /><div><strong>Schedule</strong><span>Manual runs are available from the list; scheduled runs use the desktop clock.</span></div></div>
        <Field label="Schedule"><Dropdown value={value.scheduleKind} options={[{ value: 'manual', label: 'Manual only' }, { value: 'once', label: 'Run once' }, { value: 'interval', label: 'Every interval' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'cron', label: 'Cron expression' }]} onChange={next => update('scheduleKind', next as AutomationFormValue['scheduleKind'])} /></Field>
        {value.scheduleKind === 'once' ? <div className="automation-form-grid"><Field label="Run at" required><TextInput type="datetime-local" value={value.at} onChange={event => update('at', event.target.value)} /></Field><Field label="Timezone" required><TextInput value={value.timezone} onChange={event => update('timezone', event.target.value)} /></Field></div> : null}
        {value.scheduleKind === 'interval' ? <><div className="automation-form-grid"><Field label="Every (minutes)" required><TextInput type="number" min={1} max={10080} value={value.everyMinutes} onChange={event => update('everyMinutes', event.target.value)} /></Field><Field label="Timezone" required><TextInput value={value.timezone} onChange={event => update('timezone', event.target.value)} /></Field></div><Field label="Start at (optional)"><TextInput type="datetime-local" value={value.startAt} onChange={event => update('startAt', event.target.value)} /></Field></> : null}
        {value.scheduleKind === 'daily' || value.scheduleKind === 'weekly' ? <><div className="automation-form-grid"><Field label="Time" required><TextInput type="time" value={value.time} onChange={event => update('time', event.target.value)} /></Field><Field label="Timezone" required><TextInput value={value.timezone} onChange={event => update('timezone', event.target.value)} /></Field></div>{value.scheduleKind === 'weekly' ? <div className="automation-days">{DAY_OPTIONS.map((day, index) => <Checkbox label={day} checked={value.days.includes(index)} onChange={checked => update('days', checked ? [...new Set([...value.days, index])] : value.days.filter(item => item !== index))} key={day} />)}</div> : null}</> : null}
        {value.scheduleKind === 'cron' ? <div className="automation-form-grid"><Field label="Cron expression" required><TextInput value={value.cron} onChange={event => update('cron', event.target.value)} placeholder="0 9 * * 1-5" /></Field><Field label="Timezone" required><TextInput value={value.timezone} onChange={event => update('timezone', event.target.value)} /></Field></div> : null}
      </section>

      <section className="automation-form-section"><div className="automation-form-heading"><strong>Permissions and runtime</strong><span>Keep permissions narrow. Browser access is independently enforced by the desktop host.</span></div>
        <div className="automation-form-grid"><Field label="Permission policy"><Dropdown value={value.permissionPolicy} options={[{ value: 'ask', label: 'Ask when needed' }, { value: 'allowlist', label: 'Allow selected tools' }, { value: 'review', label: 'Require review' }, { value: 'autonomous', label: 'Autonomous' }]} onChange={next => update('permissionPolicy', next as AutomationFormValue['permissionPolicy'])} /></Field><Field label="Browser access"><Dropdown value={value.browserAccess} options={[{ value: 'disabled', label: 'Disabled' }, { value: 'read-only', label: 'Read-only' }, { value: 'interactive', label: 'Interactive' }, { value: 'autonomous', label: 'Autonomous' }]} onChange={next => update('browserAccess', next as AutomationFormValue['browserAccess'])} /></Field></div>
        <div className="automation-form-grid"><Field label="Timeout (minutes)" required><TextInput type="number" min={1} max={120} value={value.timeoutMinutes} onChange={event => update('timeoutMinutes', event.target.value)} /></Field><Field label="Retry attempts" required><TextInput type="number" min={0} max={3} value={value.maxAttempts} onChange={event => update('maxAttempts', event.target.value)} /></Field></div>
        <Field label="Retry backoff (seconds)" required><TextInput type="number" min={1} max={300} value={value.backoffSeconds} onChange={event => update('backoffSeconds', event.target.value)} /></Field>
        <div className="automation-check-grid">{TOOL_OPTIONS.map(option => <Checkbox key={option.value} label={option.label} checked={value.tools.includes(option.value)} onChange={checked => update('tools', checked ? [...new Set([...value.tools, option.value])] : value.tools.filter(tool => tool !== option.value))} />)}</div>
        <div className="automation-check-grid"><Checkbox label="Notify when finished" checked={value.notifications} onChange={next => update('notifications', next)} /><Checkbox label="Keep browser session open" checked={value.keepSession} onChange={next => update('keepSession', next)} /></div>
      </section>
      {submitted && (validationError || error) ? <p className="automation-form-error" role="alert">{error ?? validationError}</p> : null}
    </div></Scrollbar>
    <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={workspaces.length === 0 || (submitted && Boolean(validationError))} onClick={() => void submit()}>{automation ? 'Save changes' : 'Create automation'}</Button></div>
  </Modal>;
}

function AutomationOptionsSkeleton() {
  return <div className="automation-options-skeleton" aria-label="Loading workspace automation options">
    <Skeleton className="automation-options-skeleton-row" />
    <Skeleton className="automation-options-skeleton-row" />
    <Skeleton className="automation-options-skeleton-wide" />
  </div>;
}

function buildInput(value: AutomationFormValue): unknown {
  const timezone = value.timezone.trim() || DEFAULT_TIMEZONE;
  const schedule = value.scheduleKind === 'manual' ? { kind: 'manual' as const } : value.scheduleKind === 'once' ? { kind: 'once' as const, at: fromLocalDateTime(value.at), timezone } : value.scheduleKind === 'interval' ? { kind: 'interval' as const, everyMinutes: Number(value.everyMinutes), ...(value.startAt ? { startAt: fromLocalDateTime(value.startAt) } : {}), timezone } : value.scheduleKind === 'daily' ? { kind: 'daily' as const, time: value.time, timezone } : value.scheduleKind === 'weekly' ? { kind: 'weekly' as const, days: value.days, time: value.time, timezone } : { kind: 'cron' as const, expression: value.cron, timezone };
  return { name: value.name, description: value.description, prompt: value.prompt, workspaceId: value.workspaceId, ...(value.branch.trim() ? { branch: value.branch.trim() } : {}), worktree: value.worktree, ...(value.model.trim() ? { model: value.model.trim() } : {}), skills: value.skills, tools: value.tools, permissionPolicy: value.permissionPolicy, browserAccess: value.browserAccess, schedule, retryPolicy: { maxAttempts: Number(value.maxAttempts), backoffMs: Number(value.backoffSeconds) * 1_000 }, timeoutMs: Number(value.timeoutMinutes) * 60_000, notifications: value.notifications, keepSession: value.keepSession };
}

const DEFAULT_BRANCH_OPTION = '__default_head__';

function fromLocalDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString(); }
function toLocalDateTime(value: string): string { const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const pad = (number: number) => String(number).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Folder, Paperclip, RotateCcw, Send, Square, Zap } from 'lucide-react';
import type { Task, Workspace, WorkspaceFileSuggestion } from '../../../../contracts/ipc/v1/workspace.js';
import type { DesktopApprovalRequest } from '../../../../contracts/ipc/v1/approval.js';
import { Button, Dropdown, Icon, IconButton, Modal, Spinner, TextArea } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import type { ApprovalMode } from '../state/approval-policy.js';
import type { QueuedMessage } from '../state/message-queue-service.js';
import type { DesktopCommandInvocation } from '../../../services/desktop-command-client.js';
import { listDesktopCommands } from '../../../services/desktop-command-client.js';
import { availableSlashCommands, createSlashCommandForm, createSlashInvocation, filterSlashCommands, modelsForSlashCommand, slashCommandLabel, slashCommandPreview, validateSlashCommandForm, type SlashCommandDefinition, type SlashCommandForm } from './slash-command.js';
import { SlashCommandPanel, SlashCommandPicker, type PickedWorkspaceFile } from './SlashCommandPanel.js';
import type { WorkspaceModelOption } from '../../../services/model-catalog.js';
import { VoiceInput } from './voice-input.js';
import { applyPromptDisplayEdit, mapPromptDisplayIndexToRaw, mapPromptRawIndexToDisplay, promptInputDisplayValue, PromptMarkup } from './prompt-markup.js';
import { ApprovalPrompt, type ApprovalDescriptor } from '../../../components/approval/ApprovalPrompt.js';
import { AttachmentPreviewList } from './AttachmentPreviewList.js';
import { QueuedMessages } from './QueuedMessages.js';
import { ExtensionCommandClient, type ExtensionRow } from '../../../services/extension-command-client.js';
import type { PromptSendOptions } from './prompt-options.js';
import { fileIconFor } from '../../../components/file-icon.js';
import { DESKTOP_REASONING_EFFORTS, type DesktopReasoningEffort } from '../../../../contracts/agent-protocol/v1/desktop.js';
import { ContextWindowUsageIndicator } from './ContextWindowUsage.js';
import type { ContextWindowUsage } from '../context-window-usage.js';

export { AttachmentPreviewList } from './AttachmentPreviewList.js';

const PROMPT_INPUT_MIN_HEIGHT = 62;
const PROMPT_INPUT_MAX_HEIGHT = 260;

type ComposerModelPickerProps = {
  models: WorkspaceModelOption[];
  selectedModel: string;
  selectedEffort: DesktopReasoningEffort;
  onModel: (model: string) => void;
  onEffort: (effort: DesktopReasoningEffort) => void;
  disabled: boolean;
};

const EFFORT_OPTIONS: readonly DesktopReasoningEffort[] = DESKTOP_REASONING_EFFORTS;

function ReasoningEffortSlider({
  selectedEffort,
  onEffort,
  disabled
}: {
  selectedEffort: DesktopReasoningEffort;
  onEffort: (effort: DesktopReasoningEffort) => void;
  disabled?: boolean;
}) {
  const currentIndex = EFFORT_OPTIONS.indexOf(selectedEffort);
  const activeIndex = currentIndex === -1 ? 1 : currentIndex;
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    if (!trackRef.current || disabled) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetIndex = Math.round(ratio * (EFFORT_OPTIONS.length - 1));
    const target = EFFORT_OPTIONS[targetIndex];
    if (target && target !== selectedEffort) {
      onEffort(target);
    }
  }, [disabled, onEffort, selectedEffort]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    isDragging.current = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || disabled) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {}
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = Math.max(0, activeIndex - 1);
      const nextEffort = EFFORT_OPTIONS[nextIndex];
      if (nextEffort) onEffort(nextEffort);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = Math.min(EFFORT_OPTIONS.length - 1, activeIndex + 1);
      const nextEffort = EFFORT_OPTIONS[nextIndex];
      if (nextEffort) onEffort(nextEffort);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = EFFORT_OPTIONS[0];
      if (first) onEffort(first);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = EFFORT_OPTIONS[EFFORT_OPTIONS.length - 1];
      if (last) onEffort(last);
    }
  };

  const progressFraction = activeIndex / (EFFORT_OPTIONS.length - 1);

  return (
    <div
      ref={trackRef}
      className="composer-effort-slider-track"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Reasoning effort"
      aria-valuemin={0}
      aria-valuemax={EFFORT_OPTIONS.length - 1}
      aria-valuenow={activeIndex}
      aria-valuetext={selectedEffort}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div
        className="composer-effort-slider-fill"
        style={{ width: `calc(14px + ${progressFraction} * (100% - 28px))` }}
      />
      {EFFORT_OPTIONS.map((effort, index) => {
        const dotFraction = index / (EFFORT_OPTIONS.length - 1);
        return (
          <div
            key={effort}
            className={`composer-effort-slider-dot${index <= activeIndex ? ' active' : ''}`}
            style={{ left: `calc(14px + ${dotFraction} * (100% - 28px))` }}
          />
        );
      })}
      <div
        className="composer-effort-slider-thumb"
        style={{ left: `calc(14px + ${progressFraction} * (100% - 28px))` }}
      />
    </div>
  );
}

function ComposerModelPicker({ models, selectedModel, selectedEffort, onModel, onEffort, disabled }: ComposerModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelLabel = (models.find(model => model.id === selectedModel)?.label ?? selectedModel) || 'Model';
  const close = useCallback(() => {
    setOpen(false);
    setModelMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  const effortText = selectedEffort.charAt(0).toUpperCase() + selectedEffort.slice(1);

  return (
    <div ref={pickerRef} className={`composer-model-picker${open ? ' open' : ''}`}>
      <button
        type="button"
        className="composer-model-trigger"
        aria-label="Select model and effort"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
      >
        <span className="composer-model-trigger-name">{modelLabel}</span>
        <span className="composer-model-trigger-effort">{selectedEffort}</span>
        <Icon icon={ChevronDown} size={14} />
      </button>
      {open ? (
        <div className="composer-effort-card">
          <div className="composer-effort-header">
            <div className="composer-effort-header-left">
              <Icon icon={Zap} size={15} />
            </div>
            <button
              type="button"
              className={`composer-effort-header-center${modelMenuOpen ? ' active' : ''}`}
              aria-label="Select model"
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen(current => !current)}
            >
              <span className="composer-effort-level">
                {effortText} <Icon icon={ChevronRight} size={12} />
              </span>
              <span className="composer-effort-model-name">
                {modelLabel}
              </span>
            </button>
            <div className="composer-effort-header-right">
              <button
                type="button"
                className="composer-effort-reset"
                aria-label="Reset reasoning effort"
                title="Reset effort to default"
                onClick={() => onEffort('medium')}
              >
                <Icon icon={RotateCcw} size={14} />
              </button>
            </div>
          </div>
          <ReasoningEffortSlider
            selectedEffort={selectedEffort}
            onEffort={onEffort}
            disabled={disabled}
          />
          {modelMenuOpen ? (
            <div className="composer-model-flyout">
              <Scrollbar className="composer-model-options">
                <div role="menu" aria-label="Models">
                  {models.map(model => (
                    <button
                      type="button"
                      role="menuitem"
                      className={`composer-model-option${model.id === selectedModel ? ' active' : ''}`}
                      key={model.id}
                      onClick={() => {
                        onModel(model.id);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span>{model.label}</span>
                      {model.id === selectedModel ? <Icon icon={Check} size={14} /> : null}
                    </button>
                  ))}
                </div>
              </Scrollbar>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Composer({ disabled, workspace, thinking, task, attachments, queuedMessages, models, selectedModel, onModel, selectedEffort, onEffort, busy, error, onSend, onRunCommand, onCancel, onDraft, onAttach, onAttachImage, onRemoveAttachment, onSteerQueued, onRemoveQueued, onEditQueued, approval, approvalMode, onApprovalMode, onApproval, showContextWindowUsage = false, contextUsage }: { disabled: boolean; workspace?: Workspace | undefined; thinking: boolean; task?: Task | undefined; attachments: AttachmentPreview[]; queuedMessages: readonly QueuedMessage[]; models: WorkspaceModelOption[]; selectedModel: string; onModel: (model: string) => void; selectedEffort: DesktopReasoningEffort; onEffort: (effort: DesktopReasoningEffort) => void; busy: boolean; error?: string | undefined; onSend: (prompt: string, options?: PromptSendOptions) => Promise<void>; onRunCommand: (invocation: DesktopCommandInvocation, preview: string) => Promise<boolean>; onCancel: () => Promise<void>; onDraft: (draft: string) => Promise<void>; onAttach: () => Promise<void>; onAttachImage: (name: string, bytes: Uint8Array) => Promise<void>; onRemoveAttachment: (attachmentId: string) => Promise<void>; onSteerQueued: (id: string) => Promise<void>; onRemoveQueued: (id: string) => Promise<void>; onEditQueued: (id: string) => Promise<QueuedMessage | undefined>; approval?: DesktopApprovalRequest | undefined; approvalMode: ApprovalMode; onApprovalMode: (mode: ApprovalMode) => void; onApproval: (approved: boolean) => Promise<void>; showContextWindowUsage?: boolean; contextUsage?: ContextWindowUsage }) {
  const [draft, setDraft] = useState(task?.draft ?? '');
  const [suggestions, setSuggestions] = useState<WorkspaceFileSuggestion[]>([]);
  const [cursor, setCursor] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputScrollTop, setInputScrollTop] = useState(0);
  const [voiceError, setVoiceError] = useState<string | undefined>();
  const [slashCommands, setSlashCommands] = useState<SlashCommandDefinition[]>([]);
  const [slashCommand, setSlashCommand] = useState<SlashCommandDefinition | undefined>();
  const [slashForm, setSlashForm] = useState<SlashCommandForm>(createSlashCommandForm());
  const [slashError, setSlashError] = useState<string | undefined>();
  const [slashValidationAttempted, setSlashValidationAttempted] = useState(false);
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [slashPickerDismissed, setSlashPickerDismissed] = useState(false);
  const pendingSelection = useRef<{ start: number; end: number }>();
  const [skillRows, setSkillRows] = useState<ExtensionRow[]>([]);
  const extensionClient = useRef(new ExtensionCommandClient());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const suggestionRequestId = useRef(0);
  // File mentions are scoped to the workspace selected in the sidebar. The task cwd
  // may point at an execution worktree and must not change the visible workspace.
  const fileSuggestionRoot = workspace?.rootPath;
  const resizePromptInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    const height = Math.min(PROMPT_INPUT_MAX_HEIGHT, Math.max(PROMPT_INPUT_MIN_HEIGHT, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > PROMPT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);
  const displayDraft = promptInputDisplayValue(draft);
  useLayoutEffect(() => {
    resizePromptInput();
    const selection = pendingSelection.current;
    if (selection === undefined || inputRef.current === null) return;
    pendingSelection.current = undefined;
    inputRef.current.setSelectionRange(selection.start, selection.end);
  }, [displayDraft, resizePromptInput]);
  useEffect(() => { setDraft(task?.draft ?? ''); setSuggestions([]); setSuggestionIndex(0); setInputScrollTop(0); setSlashCommand(undefined); setSlashForm(createSlashCommandForm()); setSlashError(undefined); setSlashValidationAttempted(false); setSlashCommandIndex(0); setSlashPickerDismissed(false); suggestionRequestId.current += 1; window.requestAnimationFrame(() => inputRef.current?.focus()); }, [task?.id]);
  useEffect(() => { suggestionRequestId.current += 1; setSuggestions([]); setSuggestionIndex(0); }, [fileSuggestionRoot]);
  useEffect(() => { const focusPrompt = () => inputRef.current?.focus(); window.addEventListener('lotagate.focusPrompt', focusPrompt); return () => window.removeEventListener('lotagate.focusPrompt', focusPrompt); }, []);
  useEffect(() => { if (!workspace) { setSlashCommands([]); return; } let mounted = true; void listDesktopCommands(workspace.rootPath).then(descriptors => { if (mounted) setSlashCommands(availableSlashCommands(descriptors)); }).catch(() => { if (mounted) setSlashCommands([]); }); return () => { mounted = false; }; }, [workspace]);
  useEffect(() => { if (!workspace) { setSkillRows([]); return; } let mounted = true; void extensionClient.current.list(workspace.rootPath, 'skill').then(rows => { if (mounted) setSkillRows(rows.filter(row => row.status === 'ENABLED')); }).catch(() => { if (mounted) setSkillRows([]); }); return () => { mounted = false; }; }, [workspace]);
  const updateSuggestions = useCallback(async (value: string, position: number) => { const requestId = ++suggestionRequestId.current; if (fileSuggestionRoot === undefined) { setSuggestions([]); return; } const match = /(?:^|\s)@([^\s]*)$/u.exec(value.slice(0, position)); if (!match) { setSuggestions([]); setSuggestionIndex(0); return; } try { const nextSuggestions = await window.lotagate.workspaces.fileSuggestions(fileSuggestionRoot, match[1] ?? ''); if (requestId !== suggestionRequestId.current) return; setSuggestions(nextSuggestions); setSuggestionIndex(0); } catch { if (requestId !== suggestionRequestId.current) return; setSuggestions([]); setSuggestionIndex(0); } }, [fileSuggestionRoot]);
  const applySuggestion = (suggestion: WorkspaceFileSuggestion) => { const displayPosition = inputRef.current?.selectionStart ?? mapPromptRawIndexToDisplay(draft, cursor); const position = mapPromptDisplayIndexToRaw(draft, displayPosition); const tokenMatch = /(?:^|\s)@([^\s]*)$/u.exec(draft.slice(0, position)); if (!tokenMatch) return; const query = tokenMatch[1] ?? ''; const tokenStart = position - query.length - 1; const next = `${draft.slice(0, tokenStart)}@${suggestion.path} ${draft.slice(position)}`; const nextCursor = tokenStart + suggestion.path.length + 2; setDraft(next); setCursor(nextCursor); setSuggestions([]); setSuggestionIndex(0); void onDraft(next); window.requestAnimationFrame(() => { inputRef.current?.focus(); const displayCursor = mapPromptRawIndexToDisplay(next, nextCursor); inputRef.current?.setSelectionRange(displayCursor, displayCursor); }); };
  const slashMatch = /^\/([^\s]*)$/u.exec(draft.trim());
  const visibleSkills = skillRows.filter(skill => !slashMatch?.[1] || skill.name.toLocaleLowerCase().startsWith((slashMatch[1] ?? '').toLocaleLowerCase()));
  const slashPickerOpen = slashCommand === undefined && slashMatch !== null && !slashPickerDismissed;
  const visibleSlashCommands = filterSlashCommands(slashCommands, slashMatch?.[1] ?? '');
  const pickerItemCount = visibleSlashCommands.length + visibleSkills.length;
  useEffect(() => { const menuOpen = slashPickerOpen || suggestions.length > 0; if (!menuOpen) return; const closeOnOutsideClick = (event: PointerEvent) => { if (composerRef.current?.contains(event.target as Node)) return; suggestionRequestId.current += 1; setSuggestions([]); setSuggestionIndex(0); setSlashPickerDismissed(true); }; document.addEventListener('pointerdown', closeOnOutsideClick); return () => document.removeEventListener('pointerdown', closeOnOutsideClick); }, [slashPickerOpen, suggestions.length]);
  useEffect(() => { setSlashCommandIndex(current => pickerItemCount === 0 ? 0 : Math.min(current, pickerItemCount - 1)); }, [slashMatch?.[1], pickerItemCount]);
  useEffect(() => { const option = suggestionRefs.current[suggestionIndex]; if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' }); }, [suggestionIndex, suggestions.length]);
  const currentSlashModel = slashForm.values['model'];
  useEffect(() => { if (!slashCommand) return; const compatibleModels = modelsForSlashCommand(slashCommand, models); if (compatibleModels.length === 0 || (typeof currentSlashModel === 'string' && compatibleModels.some(model => model.id === currentSlashModel))) return; const firstModel = compatibleModels[0]; if (!firstModel) return; setSlashForm(current => { const selectedModel = current.values['model']; return typeof selectedModel === 'string' && compatibleModels.some(model => model.id === selectedModel) ? current : { ...current, values: { ...current.values, model: firstModel.id } }; }); }, [currentSlashModel, models, slashCommand]);
  const chooseSlashCommand = (next: SlashCommandDefinition) => { setSlashPickerDismissed(false); setSlashCommand(next); setSlashForm(createSlashCommandForm(next, models)); setDraft(''); void onDraft(''); setSuggestions([]); setSlashError(undefined); setSlashValidationAttempted(false); setSlashCommandIndex(0); };
  const chooseSkill = (next: Pick<ExtensionRow, 'name'>) => { const value = `/${next.name} `; setSlashPickerDismissed(false); setDraft(value); setCursor(value.length); void onDraft(value); setSuggestions([]); setSlashCommandIndex(0); window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(value.length, value.length); }); };
  const clearSlashCommand = () => { setSlashCommand(undefined); setSlashForm(createSlashCommandForm()); setSlashError(undefined); setSlashValidationAttempted(false); setSlashCommandIndex(0); setSlashPickerDismissed(false); setDraft(''); void onDraft(''); window.requestAnimationFrame(() => inputRef.current?.focus()); };
  const send = async () => { if (disabled || busy) return; if (slashCommand) { setSlashValidationAttempted(true); try { const invocation = createSlashInvocation(slashCommand, slashForm); const preview = slashCommandPreview(slashCommand, slashForm); setSlashCommand(undefined); setSlashForm(createSlashCommandForm()); setSlashError(undefined); setSlashValidationAttempted(false); await onRunCommand(invocation, preview); } catch (reason) { setSlashError(reason instanceof Error ? reason.message : 'Unable to run slash command.'); } return; } const value = draft.trim(); if (!value) return; const skillMatch = /^\/([^\s]+)(?:\s+([\s\S]*))?$/u.exec(value); const skillName = skillMatch?.[1]; const skill = skillName === undefined ? undefined : skillRows.find(row => row.name === skillName); const requestedScope = skillMatch?.[2]?.trim(); const options: PromptSendOptions | undefined = skill === undefined ? undefined : { skills: [skill.name], agentPrompt: requestedScope ? `Use the selected skill "${skill.name}" for this request.\n\nRequested scope:\n${requestedScope}` : `Use the selected skill "${skill.name}" for this request.` }; setDraft(''); void onDraft(''); setSuggestions([]); setSuggestionIndex(0); setVoiceError(undefined); await onSend(value, options); };
  const completeVoiceInput = useCallback((transcript: string) => { const spoken = transcript.trim(); if (!spoken) return; const next = draft.trimEnd() ? `${draft.trimEnd()} ${spoken}` : spoken; setDraft(next); void onDraft(next); setVoiceError(undefined); }, [draft, onDraft]);
  const options = models.map(model => ({ value: model.id, label: model.label }));
  const approvalOptions = [{ value: 'auto', label: 'Approve for me' }, { value: 'ask', label: 'Ask for approval' }];
  const stopOrSend = thinking && !draft.trim() && slashCommand === undefined;
  const slashErrors = slashCommand === undefined ? { fields: {} } : validateSlashCommandForm(slashCommand, slashForm, { showRequired: slashValidationAttempted });
  const promptComposerInput = <><div className="prompt-input-wrap"><div className="prompt-highlight-layer" aria-hidden="true" style={{ transform: `translateY(-${inputScrollTop}px)` }}><PromptMarkup content={draft} /></div><TextArea ref={inputRef} className="prompt-input" aria-label="Prompt" {...(suggestions.length > 0 ? { 'aria-activedescendant': `mention-option-${suggestionIndex}`, 'aria-controls': 'mention-suggestions-list' } : {})} disabled={disabled} placeholder={disabled ? 'Select a workspace to start a chat' : 'Do anything'} value={displayDraft} onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length === 0) return; event.preventDefault(); void (async () => { for (const file of files) await onAttachImage(file.name || 'Pasted image', new Uint8Array(await file.arrayBuffer())); })(); }} onScroll={event => setInputScrollTop(event.currentTarget.scrollTop)} onChange={event => { setSlashPickerDismissed(false); const nextDraft = applyPromptDisplayEdit(draft, event.target.value); pendingSelection.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; const nextCursor = mapPromptDisplayIndexToRaw(nextDraft, event.target.selectionStart); setDraft(nextDraft); setCursor(nextCursor); void onDraft(nextDraft); void updateSuggestions(nextDraft, nextCursor); }} onClick={event => { setSlashPickerDismissed(false); const nextCursor = mapPromptDisplayIndexToRaw(draft, event.currentTarget.selectionStart); setCursor(nextCursor); void updateSuggestions(draft, nextCursor); }} onKeyDown={event => { if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); event.stopPropagation(); setSuggestionIndex(current => event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current - 1 + suggestions.length) % suggestions.length); return; } if (suggestions.length > 0 && event.key === 'Escape') { event.preventDefault(); suggestionRequestId.current += 1; setSuggestions([]); setSuggestionIndex(0); return; } if (suggestions.length > 0 && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); applySuggestion(suggestions[suggestionIndex] ?? suggestions[0]!); return; } if (slashPickerOpen && event.key === 'Escape') { event.preventDefault(); setSlashPickerDismissed(true); return; } if (slashPickerOpen && pickerItemCount > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setSlashCommandIndex(current => event.key === 'ArrowDown' ? (current + 1) % pickerItemCount : (current - 1 + pickerItemCount) % pickerItemCount); return; } if (slashPickerOpen && pickerItemCount > 0 && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const command = visibleSlashCommands[slashCommandIndex]; if (command) chooseSlashCommand(command); else { const skill = visibleSkills[slashCommandIndex - visibleSlashCommands.length]; if (skill) chooseSkill(skill); } return; } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /></div>{slashPickerOpen ? <SlashCommandPicker commands={visibleSlashCommands} skills={visibleSkills.map(skill => ({ name: skill.name, description: skill.detail }))} selectedIndex={slashCommandIndex} onHover={setSlashCommandIndex} onSelect={chooseSlashCommand} onSelectSkill={chooseSkill} /> : null}{suggestions.length > 0 ? <Scrollbar className="mention-suggestions-scrollbar"><div id="mention-suggestions-list" className="mention-suggestions" role="listbox" aria-label="Workspace files">{suggestions.map((suggestion, index) => <button ref={element => { suggestionRefs.current[index] = element; }} type="button" id={`mention-option-${index}`} key={`${suggestion.kind}:${suggestion.path}`} className={index === suggestionIndex ? 'selected' : undefined} role="option" aria-selected={index === suggestionIndex} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => applySuggestion(suggestion)}><Icon icon={suggestion.kind === 'folder' ? Folder : fileIconFor({ name: suggestion.path })} size={16} /><SuggestionPath path={suggestion.path} /></button>)}</div></Scrollbar> : null}<div className="composer-footer"><IconButton icon={Paperclip} iconSize={16} label="Attach context" disabled={disabled} onClick={() => void onAttach()} /><div className="approval-mode"><Dropdown value={approvalMode} options={approvalOptions} onChange={value => onApprovalMode(value as ApprovalMode)} disabled={disabled || thinking} /></div><span className="composer-spacer" /><div className="composer-model-selection">{showContextWindowUsage && contextUsage !== undefined ? <ContextWindowUsageIndicator usage={contextUsage} /> : null}{options.length > 0 ? <ComposerModelPicker models={models} selectedModel={selectedModel} selectedEffort={selectedEffort} onModel={onModel} onEffort={onEffort} disabled={disabled || thinking} /> : <span className="model-label">Model · CLI policy</span>}</div><VoiceInput disabled={disabled || thinking} onComplete={completeVoiceInput} onError={setVoiceError} /><Button variant="primary" aria-label={stopOrSend ? 'Cancel response' : 'Send'} disabled={disabled || busy} onClick={() => stopOrSend ? void onCancel() : void send()}>{stopOrSend ? <Icon icon={Square} size={15} /> : busy ? <Spinner label="" /> : <Icon icon={Send} size={16} />}</Button></div>{error || voiceError || slashError ? <p className="composer-error">{error ?? voiceError ?? slashError}</p> : null}</>;
  return <div ref={composerRef} className={`composer ${disabled ? 'composer-disabled' : ''}`}><AttachmentPreviewList {...(task?.id === undefined ? {} : { taskId: task.id })} attachments={attachments} onRemove={onRemoveAttachment} /><QueuedMessages {...(task?.id === undefined ? {} : { taskId: task.id })} messages={queuedMessages} onSteer={onSteerQueued} onRemove={onRemoveQueued} onEdit={id => { void (async () => { const message = await onEditQueued(id); if (!message) return; setDraft(message.prompt); void onDraft(message.prompt); window.requestAnimationFrame(() => inputRef.current?.focus()); })(); }} />{slashCommand ? <Modal title={slashCommandLabel(slashCommand)} subtitle={slashCommand.description} className="slash-command-dialog" onClose={clearSlashCommand}><Scrollbar className="slash-command-modal-scroll"><SlashCommandPanel command={slashCommand} form={slashForm} models={models} errors={slashErrors} onChange={setSlashForm} onToggleAdvanced={() => setSlashForm(current => ({ ...current, advancedOpen: !current.advancedOpen }))} onClear={clearSlashCommand} onPickFolder={() => window.lotagate.workspaces.pickFolder()} onPickFile={async extensions => { const path = await window.lotagate.workspaces.pickFile(undefined, extensions === undefined ? undefined : [...extensions]); return path === null ? null : { path, sizeBytes: await window.lotagate.workspaces.fileSize(undefined, path) } satisfies PickedWorkspaceFile; }} onPickMultipleFile={async extensions => { const paths = await window.lotagate.workspaces.pickMultipleFile(undefined, extensions === undefined ? undefined : [...extensions]); return Promise.all(paths.map(async path => ({ path, sizeBytes: await window.lotagate.workspaces.fileSize(undefined, path) } satisfies PickedWorkspaceFile))); }} showHeader={false} /></Scrollbar><div className="modal-actions"><Button variant="secondary" onClick={clearSlashCommand}>Cancel</Button><Button variant="primary" disabled={busy || slashErrors.primary !== undefined || Object.keys(slashErrors.fields).length > 0} onClick={() => void send()}>{busy ? 'Running…' : 'Run command'}</Button></div></Modal> : null}{approval ? <ApprovalPrompt request={toApprovalDescriptor(approval)} onDecision={onApproval} /> : promptComposerInput}</div>;
}

function SuggestionPath({ path }: { path: string }) {
  return <span className="mention-suggestion-copy"><strong>{path}</strong></span>;
}

function toApprovalDescriptor(request: DesktopApprovalRequest): ApprovalDescriptor {
  return {
    approvalId: request.approvalId,
    toolName: request.toolName,
    displayName: request.displayName ?? request.toolName,
    kind: request.kind ?? 'action',
    detail: request.detail,
    ...(request.executionBoundary === undefined ? {} : { executionBoundary: request.executionBoundary }),
    ...(request.fallbackReason === undefined ? {} : { fallbackReason: request.fallbackReason }),
  };
}

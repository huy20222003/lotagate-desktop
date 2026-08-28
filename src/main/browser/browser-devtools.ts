import type { WebContents } from 'electron';

export interface BrowserViewport { width: number; height: number; mobile: boolean; deviceScaleFactor: number; }
export interface BrowserAccessibilityNode { role?: string; name?: string; description?: string; focused?: boolean; disabled?: boolean; checked?: boolean | string; expanded?: boolean; }
export interface BrowserDialog { type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'; message: string; defaultPrompt?: string; url: string; }

export async function setViewport(contents: WebContents, viewport: BrowserViewport): Promise<void> {
  await withDebugger(contents, async debuggerInstance => {
    await debuggerInstance.sendCommand('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, mobile: viewport.mobile, deviceScaleFactor: viewport.deviceScaleFactor });
  });
}

export async function resetViewport(contents: WebContents): Promise<void> {
  await withDebugger(contents, debuggerInstance => debuggerInstance.sendCommand('Emulation.clearDeviceMetricsOverride'));
}

export async function accessibilityTree(contents: WebContents): Promise<BrowserAccessibilityNode[]> {
  return withDebugger(contents, async debuggerInstance => {
    const result = await debuggerInstance.sendCommand('Accessibility.getFullAXTree') as { nodes?: unknown[] };
    return (result.nodes ?? []).slice(0, 300).map(simplifyAccessibilityNode).filter((node): node is BrowserAccessibilityNode => node !== undefined);
  });
}

export async function uploadFile(contents: WebContents, selector: string, filePath: string): Promise<void> {
  await withDebugger(contents, async debuggerInstance => {
    await debuggerInstance.sendCommand('DOM.enable');
    const document = await debuggerInstance.sendCommand('DOM.getDocument', { depth: 0 }) as { root?: { nodeId?: number } };
    const rootNodeId = document.root?.nodeId;
    if (rootNodeId === undefined) throw new Error('Unable to inspect the browser document.');
    const match = await debuggerInstance.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector }) as { nodeId?: number };
    if (match.nodeId === undefined || match.nodeId === 0) throw new Error('The requested file input was not found.');
    await debuggerInstance.sendCommand('DOM.setFileInputFiles', { nodeId: match.nodeId, files: [filePath] });
  });
}

export async function handleDialog(contents: WebContents, accept: boolean, promptText?: string): Promise<void> {
  await withDebugger(contents, debuggerInstance => debuggerInstance.sendCommand('Page.handleJavaScriptDialog', { accept, ...(promptText === undefined ? {} : { promptText }) }));
}

export async function enableDialogEvents(contents: WebContents, onDialog: (dialog: BrowserDialog) => void): Promise<void> {
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Page.enable');
    contents.debugger.on('message', (_event, method, params) => {
      if (method !== 'Page.javascriptDialogOpening' || !isRecord(params)) return;
      const type = params['type'];
      if (type !== 'alert' && type !== 'confirm' && type !== 'prompt' && type !== 'beforeunload') return;
      onDialog({ type, message: redact(String(params['message'] ?? '')), ...(typeof params['defaultPrompt'] === 'string' ? { defaultPrompt: redact(params['defaultPrompt']) } : {}), url: safeUrl(typeof params['url'] === 'string' ? params['url'] : '') });
    });
  } catch {
    // DevTools may already be owned by another inspector. Browser interaction
    // remains available; dialog handling will report an actionable error.
  }
}

async function withDebugger<T>(contents: WebContents, action: (debuggerInstance: WebContents['debugger']) => Promise<T>): Promise<T> {
  const wasAttached = contents.debugger.isAttached();
  if (!wasAttached) contents.debugger.attach('1.3');
  try { return await action(contents.debugger); }
  finally { if (!wasAttached && contents.debugger.isAttached()) contents.debugger.detach(); }
}

function simplifyAccessibilityNode(value: unknown): BrowserAccessibilityNode | undefined {
  if (!isRecord(value)) return undefined;
  const role = axString(value['role']);
  const name = axString(value['name']);
  const description = axString(value['description']);
  const properties = Array.isArray(value['properties']) ? value['properties'] : [];
  const result: BrowserAccessibilityNode = {
    ...(role === undefined ? {} : { role }), ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
  };
  for (const property of properties) {
    if (!isRecord(property) || typeof property['name'] !== 'string') continue;
    const propertyValue = axValue(property['value']);
    if (property['name'] === 'focused' && typeof propertyValue === 'boolean') result.focused = propertyValue;
    if (property['name'] === 'disabled' && typeof propertyValue === 'boolean') result.disabled = propertyValue;
    if (property['name'] === 'checked' && (typeof propertyValue === 'boolean' || typeof propertyValue === 'string')) result.checked = propertyValue;
    if (property['name'] === 'expanded' && typeof propertyValue === 'boolean') result.expanded = propertyValue;
  }
  return result;
}

function axString(value: unknown): string | undefined { const result = axValue(value); return typeof result === 'string' && result.length > 0 ? result.slice(0, 512) : undefined; }
function axValue(value: unknown): unknown { return isRecord(value) && 'value' in value ? value['value'] : value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safeUrl(value: string): string { try { const url = new URL(value); url.username = ''; url.password = ''; url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/token|key|secret|password|auth|signature/iu.test(key)) url.searchParams.set(key, '[REDACTED]'); return url.toString().slice(0, 4_096); } catch { return redact(value); } }
function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]').slice(0, 4_096); }

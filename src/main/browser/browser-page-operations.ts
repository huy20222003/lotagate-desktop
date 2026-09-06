import type { WebContents } from 'electron';
import type { BrowserElementInspection, BrowserFrameSnapshot, BrowserInteractionResult, BrowserPageState, BrowserTableSnapshot, BrowserTarget, BrowserWaitCondition } from './browser-types.js';
import { delay, isElementInspection, isInteractionResult, isPageInspection, serializeForJavaScript } from './browser-service-support.js';

export async function inspectBrowserPage(contents: WebContents): Promise<Omit<BrowserPageState, 'tab'>> {
  const page = await contents.executeJavaScript(`(() => {
    const visibleText = (document.body?.innerText ?? '').slice(0, 20000);
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 100).map((element) => ({ level: Number(element.tagName.slice(1)), text: (element.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 512) }));
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((element) => ({ text: (element.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 512), url: element.href.slice(0, 4096) }));
    const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]')).slice(0, 200).map((element) => {
      const html = element;
      const input = element;
      const role = element.getAttribute('role') || element.tagName.toLowerCase();
      const name = element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || (html.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 256);
      return { role, name, tag: element.tagName.toLowerCase(), ...(input.type ? { type: input.type } : {}), disabled: Boolean(element.disabled) };
    });
    return { readyState: document.readyState, html: (document.documentElement?.outerHTML ?? '').slice(0, 30000), visibleText, headings, links, elements };
  })()`, true) as unknown;
  if (!isPageInspection(page)) return { visibleText: '', readyState: 'unknown', html: '', headings: [], links: [], elements: [] };
  return page;
}

export async function inspectBrowserElement(contents: WebContents, target: BrowserTarget): Promise<BrowserElementInspection> {
  const result = await contents.executeJavaScript(`(() => {
    const target = ${serializeForJavaScript(target)};
    const normalized = (input) => (input || '').trim().replace(/\\s+/gu, ' ').toLowerCase();
    const nameOf = (element) => normalized(element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || element.innerText || element.textContent);
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3,h4,h5,h6'));
    let element;
    if (target.type === 'css') element = document.querySelector(target.selector);
    else if (target.type === 'coordinates') element = document.elementFromPoint(target.x, target.y);
    else if (target.type === 'text') element = candidates.find((candidate) => nameOf(candidate).includes(normalized(target.value)));
    else if (target.type === 'accessibility') element = candidates.find((candidate) => (!target.role || (candidate.getAttribute('role') || candidate.tagName.toLowerCase()) === target.role) && (!target.name || nameOf(candidate).includes(normalized(target.name))));
    if (!(element instanceof HTMLElement)) return { found: false, description: 'The requested browser element was not found.' };
    const computed = getComputedStyle(element);
    const attributes = {};
    for (const name of ['id', 'class', 'role', 'aria-label', 'name', 'type', 'href', 'title', 'data-testid']) {
      const value = element.getAttribute(name);
      if (value !== null) attributes[name] = value.slice(0, 512);
    }
    const input = element;
    const isPassword = input instanceof HTMLInputElement && input.type.toLowerCase() === 'password';
    const rect = element.getBoundingClientRect();
    const style = {};
    for (const name of ['display', 'position', 'visibility', 'opacity', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'width', 'height', 'margin', 'padding', 'border', 'borderRadius', 'overflow', 'zIndex']) style[name] = computed[name];
    return { found: true, description: 'Inspected ' + element.tagName.toLowerCase() + '.', tag: element.tagName.toLowerCase(), ...(element.id ? { id: element.id.slice(0, 256) } : {}), ...(element.getAttribute('role') ? { role: element.getAttribute('role') } : {}), name: nameOf(element).slice(0, 256), text: (element.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 4096), ...(!isPassword && typeof input.value === 'string' ? { value: input.value.slice(0, 4096) } : {}), ...(input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio') ? { checked: input.checked } : {}), attributes, computedStyle: style, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, outerHTML: element.outerHTML.slice(0, 12000) };
  })()`, true) as unknown;
  if (!isElementInspection(result)) throw new Error('Browser returned an invalid element inspection.');
  return result;
}

export async function extractBrowserTable(contents: WebContents, target: BrowserTarget, maxRows: number): Promise<BrowserTableSnapshot> {
  const boundedRows = Math.min(500, Math.max(1, Math.floor(maxRows)));
  const result = await contents.executeJavaScript(`(() => {
    const target = ${serializeForJavaScript(target)};
    const normalize = (input) => (input || '').trim().replace(/\\s+/gu, ' ');
    const tables = Array.from(document.querySelectorAll('table'));
    const nameOf = (element) => normalize(element.getAttribute('aria-label') || element.getAttribute('name') || element.innerText || element.textContent);
    let element;
    if (target.type === 'css') element = document.querySelector(target.selector);
    else if (target.type === 'coordinates') element = document.elementFromPoint(target.x, target.y);
    else if (target.type === 'text') element = tables.find((candidate) => nameOf(candidate).toLowerCase().includes(normalize(target.value).toLowerCase()));
    else element = tables.find((candidate) => (!target.role || (candidate.getAttribute('role') || 'table') === target.role) && (!target.name || nameOf(candidate).toLowerCase().includes(normalize(target.name).toLowerCase())));
    const table = element instanceof HTMLTableElement ? element : element?.closest?.('table');
    if (!(table instanceof HTMLTableElement)) return { found: false, description: 'The requested HTML table was not found.', headers: [], rows: [], truncated: false };
    const allRows = Array.from(table.querySelectorAll('tr'));
    const headerSource = Array.from(table.querySelectorAll('thead tr')).at(-1) || allRows.find((row) => row.querySelector('th'));
    const cells = (row) => Array.from(row.querySelectorAll(':scope > th, :scope > td')).slice(0, 100).map((cell) => normalize(cell.innerText || cell.textContent).slice(0, 4096));
    const headers = headerSource ? cells(headerSource) : [];
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    const sourceRows = bodyRows.length > 0 ? bodyRows : allRows.filter((row) => row !== headerSource);
    const rows = sourceRows.slice(0, ${boundedRows}).map(cells);
    return { found: true, description: 'Extracted HTML table.', headers, rows, truncated: sourceRows.length > rows.length };
  })()`, true) as unknown;
  if (!isTableSnapshot(result)) throw new Error('Browser returned an invalid table extraction.');
  return result;
}

export async function dragBrowserTarget(contents: WebContents, from: BrowserTarget, to: BrowserTarget): Promise<BrowserInteractionResult> {
  const result = await contents.executeJavaScript(`(() => {
    const from = ${serializeForJavaScript(from)}; const to = ${serializeForJavaScript(to)};
    const resolve = (target) => {
      const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[draggable="true"]'));
      const normalize = (input) => (input || '').trim().replace(/\\s+/gu, ' ').toLowerCase();
      const nameOf = (element) => normalize(element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || element.innerText || element.textContent);
      if (target.type === 'css') return document.querySelector(target.selector);
      if (target.type === 'coordinates') return document.elementFromPoint(target.x, target.y);
      if (target.type === 'text') return candidates.find((candidate) => nameOf(candidate).includes(normalize(target.value)));
      return candidates.find((candidate) => (!target.role || (candidate.getAttribute('role') || candidate.tagName.toLowerCase()) === target.role) && (!target.name || nameOf(candidate).includes(normalize(target.name))));
    };
    const source = resolve(from); const destination = resolve(to);
    if (!(source instanceof HTMLElement) || !(destination instanceof HTMLElement)) return { found: false, description: 'The drag source or destination was not found.' };
    source.scrollIntoView({ block: 'center', inline: 'center' }); destination.scrollIntoView({ block: 'center', inline: 'center' });
    const sourceRect = source.getBoundingClientRect(); const destinationRect = destination.getBoundingClientRect();
    const point = (rect) => ({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true, view: window });
    const data = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { ...point(sourceRect), dataTransfer: data }));
    destination.dispatchEvent(new DragEvent('dragenter', { ...point(destinationRect), dataTransfer: data }));
    destination.dispatchEvent(new DragEvent('dragover', { ...point(destinationRect), dataTransfer: data }));
    destination.dispatchEvent(new DragEvent('drop', { ...point(destinationRect), dataTransfer: data }));
    source.dispatchEvent(new DragEvent('dragend', { ...point(destinationRect), dataTransfer: data }));
    return { found: true, description: 'Dragged the page element to the destination.', tag: source.tagName.toLowerCase() };
  })()`, true) as unknown;
  if (!isBrowserInteractionResult(result)) throw new Error('Browser returned an invalid drag result.');
  return result;
}

export async function listBrowserFrames(contents: WebContents): Promise<BrowserFrameSnapshot[]> {
  const result = await contents.executeJavaScript(`Array.from(document.querySelectorAll('iframe,frame')).slice(0, 100).map((frame, index) => ({ frameId: frame.id || frame.name || 'frame-' + index, name: frame.name || frame.id || '', url: frame.src || '', sameOrigin: (() => { try { return frame.contentWindow?.location.origin === window.location.origin; } catch { return false; } })() }))`, true) as unknown;
  if (!Array.isArray(result) || result.some((item) => !isFrameSnapshot(item))) throw new Error('Browser returned an invalid frame list.');
  return result as BrowserFrameSnapshot[];
}

export async function executeBrowserTargetAction(contents: WebContents, target: BrowserTarget, action: 'click' | 'type' | 'focus' | 'clear' | 'hover' | 'check' | 'select' | 'read', value?: string): Promise<BrowserInteractionResult> {
  const serializedTarget = serializeForJavaScript(target);
  const serializedAction = JSON.stringify(action);
  const serializedValue = serializeForJavaScript(value ?? '');
  const result = await contents.executeJavaScript(`(() => {
    const target = ${serializedTarget};
    const action = ${serializedAction};
    const value = ${serializedValue};
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]'));
    const normalized = (input) => (input || '').trim().replace(/\\s+/gu, ' ').toLowerCase();
    const nameOf = (element) => normalized(element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || element.innerText || element.textContent);
    let element;
    if (target.type === 'css') element = document.querySelector(target.selector);
    else if (target.type === 'coordinates') element = document.elementFromPoint(target.x, target.y);
    else if (target.type === 'text') element = candidates.find((candidate) => nameOf(candidate) === normalized(target.value) || nameOf(candidate).includes(normalized(target.value)));
    else if (target.type === 'accessibility') element = candidates.find((candidate) => (!target.role || (candidate.getAttribute('role') || candidate.tagName.toLowerCase()) === target.role) && (!target.name || nameOf(candidate) === normalized(target.name) || nameOf(candidate).includes(normalized(target.name))));
    if (!(element instanceof HTMLElement)) return { found: false, description: 'The requested browser element was not found.' };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const tag = element.tagName.toLowerCase();
    const name = element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || (element.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 256);
    if (action === 'focus') { element.focus(); return { found: true, description: 'Focused ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name }; }
    if (action === 'hover') { element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window })); element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window })); return { found: true, description: 'Hovered ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name }; }
    if (action === 'read') { if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') return { found: false, description: 'Reading password fields is blocked.', tag, name }; const field = element; return { found: true, description: 'Read ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name, ...(typeof field.value === 'string' ? { value: field.value.slice(0, 4096) } : {}) }; }
    if (action === 'clear') { if (element.matches(':disabled,[readonly]')) return { found: false, description: 'The requested browser field is disabled or read-only.', tag, name }; const input = element; const prototype = Object.getPrototypeOf(input); const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value'); if (descriptor?.set) descriptor.set.call(input, ''); else input.value = ''; element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); element.dispatchEvent(new Event('change', { bubbles: true })); return { found: true, description: 'Cleared ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name }; }
    if (action === 'check') { const input = element; if (input.type !== 'checkbox' && input.type !== 'radio') return { found: false, description: 'The requested element is not a checkbox or radio input.', tag, name }; const checked = value === 'true'; input.checked = checked; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return { found: true, description: (checked ? 'Checked ' : 'Unchecked ') + tag + (name ? ' (' + name + ')' : '') + '.', tag, name, checked }; }
    if (action === 'select') { if (!(element instanceof HTMLSelectElement)) return { found: false, description: 'The requested element is not a select input.', tag, name }; const option = [...element.options].find(candidate => candidate.value === value || candidate.textContent?.trim() === value); if (!option) return { found: false, description: 'The requested select option was not found.', tag, name }; element.value = option.value; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return { found: true, description: 'Selected an option in ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name, value: element.value }; }
    if (action === 'click') { if (element.matches(':disabled,[aria-disabled="true"]')) return { found: false, description: 'The requested browser element is disabled.', tag, name }; element.click(); return { found: true, description: 'Clicked ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name }; }
    const input = element; if (element.matches(':disabled,[readonly]')) return { found: false, description: 'The requested browser field is disabled or read-only.', tag, name }; element.focus(); if (element.isContentEditable) element.textContent = value; else { const prototype = Object.getPrototypeOf(input); const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value'); if (descriptor?.set) descriptor.set.call(input, value); else input.value = value; } element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); element.dispatchEvent(new Event('change', { bubbles: true })); return { found: true, description: 'Entered text into ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name };
  })()`, true) as unknown;
  if (!isInteractionResult(result)) throw new Error('Browser returned an invalid interaction result.');
  return result;
}

export async function waitForBrowserCondition(contents: WebContents, condition: BrowserWaitCondition, timeoutMs: number): Promise<BrowserInteractionResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const found = await contents.executeJavaScript(`(() => { const condition = ${serializeForJavaScript(condition)}; if (condition.type === 'url') return window.location.href.includes(condition.value); if (condition.type === 'text') return (document.body?.innerText ?? '').includes(condition.value); return document.querySelector(condition.value) !== null; })()`, true) as unknown;
    if (found === true) return { found: true, description: `Wait condition ${condition.type} matched.` };
    await delay(100);
  }
  return { found: false, description: `Timed out waiting for ${condition.type}.` };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isBrowserInteractionResult(value: unknown): value is BrowserInteractionResult { return isRecord(value) && typeof value['found'] === 'boolean' && typeof value['description'] === 'string'; }
function isTableSnapshot(value: unknown): value is BrowserTableSnapshot { return isRecord(value) && typeof value['found'] === 'boolean' && typeof value['description'] === 'string' && Array.isArray(value['headers']) && value['headers'].every((item) => typeof item === 'string') && Array.isArray(value['rows']) && value['rows'].every((row) => Array.isArray(row) && row.every((item) => typeof item === 'string')) && typeof value['truncated'] === 'boolean'; }
function isFrameSnapshot(value: unknown): value is BrowserFrameSnapshot { return isRecord(value) && typeof value['frameId'] === 'string' && typeof value['name'] === 'string' && typeof value['url'] === 'string' && typeof value['sameOrigin'] === 'boolean'; }

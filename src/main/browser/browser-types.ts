import type { BrowserTabSnapshot } from '../../contracts/ipc/v1/workspace.js';

export interface BrowserConsoleEntry { level: string; message: string; timestamp: string; }
export interface BrowserScreenshot { evidenceId: string; path: string; dataUrl: string; }
export type BrowserTarget =
  | { type: 'accessibility'; role?: string; name?: string }
  | { type: 'text'; value: string }
  | { type: 'css'; selector: string }
  | { type: 'coordinates'; x: number; y: number };
export interface BrowserPageState {
  tab: BrowserTabSnapshot;
  visibleText: string;
  readyState: string;
  html: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; url: string }>;
  elements: Array<{ role: string; name: string; tag: string; type?: string; disabled: boolean }>;
}
export interface BrowserElementInspection {
  found: boolean;
  tag?: string;
  id?: string;
  role?: string;
  name?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  attributes?: Record<string, string>;
  computedStyle?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  outerHTML?: string;
  description: string;
}
export interface BrowserInteractionResult { found: boolean; description: string; tag?: string; name?: string; value?: string; checked?: boolean; }
export type BrowserWaitCondition = { type: 'selector' | 'text' | 'url'; value: string };

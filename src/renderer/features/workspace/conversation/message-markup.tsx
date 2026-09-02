import { Children, useState, type ReactNode } from 'react';
import { Globe2 } from 'lucide-react';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { Icon, Tooltip } from '../../../components/ui.js';
import { fileIconFor } from '../../../components/file-icon.js';

export interface MessageFileReference {
  path: string;
  name?: string;
  kind?: Artifact['kind'];
  mention?: string;
}

export function resolveWorkspacePath(path: string, workspaceCwd?: string): string {
  if (workspaceCwd === undefined || isAbsolutePath(path)) return path;
  const separator = workspaceCwd.includes('\\') ? '\\' : '/';
  const relativePath = path.replace(/^\.([\\/])/u, '').replace(/[\\/]+/gu, separator);
  return `${workspaceCwd.replace(/[\\/]+$/u, '')}${separator}${relativePath}`;
}

export function MessageMarkup({ content, fileReferences = [], workspaceCwd, highlightPromptTokens = false }: { content: string; fileReferences?: readonly MessageFileReference[]; workspaceCwd?: string; highlightPromptTokens?: boolean }): ReactNode {
  const references = mergeFileReferences(fileReferences, [...extractAbsoluteFilePaths(content).map(path => ({ path })), ...extractMentionedFileReferences(content, workspaceCwd), ...extractBareFileReferences(content, workspaceCwd)]);
  const tokens = tokenizeMessage(content, references, highlightPromptTokens);
  return <>{tokens.map((token, index) => token.kind === 'text' ? <span key={`text:${index}`}>{token.value}</span> : token.kind === 'file' ? <MessageFileLink key={`file:${token.path}:${index}`} reference={token.reference} /> : token.kind === 'prompt' ? <span className="prompt-token" key={`prompt:${index}`}>{token.value}</span> : <MessageExternalLink key={`url:${token.url}:${index}`} href={token.url} />)}</>;
}

export function MessageExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  const label = textContent(children) || websiteLabel(href);
  return <Tooltip label={href}><a className="message-external-link" href={href} target="_blank" rel="noreferrer"><WebsiteFavicon href={href} label={label} /><span>{label}</span></a></Tooltip>;
}

function MessageFileLink({ reference }: { reference: MessageFileReference }) {
  const name = reference.name ?? fileName(reference.path);
  const FileIcon = fileIconFor({ name, kind: reference.kind });
  return <Tooltip label={reference.path}><a className="message-file-reference" href="#reveal-file" onClick={event => { event.preventDefault(); void window.lotagate.operations.revealPath(reference.path).catch(() => undefined); }}><Icon icon={FileIcon} size={14} /><span>{name}</span></a></Tooltip>;
}

function WebsiteFavicon({ href, label }: { href: string; label: string }) {
  const [source, setSource] = useState<'site' | 'proxy' | 'fallback'>('site');
  if (source === 'fallback') return <Icon icon={Globe2} size={13} label={`${label} website`} />;
  return <img className="message-link-favicon" src={source === 'site' ? faviconUrl(href) : faviconProxyUrl(href)} alt="" referrerPolicy="no-referrer" onError={() => setSource(current => current === 'site' ? 'proxy' : 'fallback')} />;
}

function tokenizeMessage(content: string, references: readonly MessageFileReference[], highlightPromptTokens: boolean): MessageToken[] {
  const tokens: MessageToken[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const next = findNextToken(content, cursor, references, highlightPromptTokens);
    if (next === undefined) { tokens.push({ kind: 'text', value: content.slice(cursor) }); break; }
    if (next.index > cursor) tokens.push({ kind: 'text', value: content.slice(cursor, next.index) });
    tokens.push(next.token);
    cursor = next.index + next.length;
  }
  return tokens;
}

function findNextToken(content: string, cursor: number, references: readonly MessageFileReference[], highlightPromptTokens: boolean): { index: number; length: number; token: MessageToken } | undefined {
  const candidates: Array<{ index: number; length: number; token: MessageToken }> = [];
  for (const reference of references) {
    const start = content.indexOf(reference.path, cursor);
    if (start >= 0 && isFileBoundary(content, start, reference.path.length)) candidates.push({ index: start, length: reference.path.length, token: { kind: 'file', path: reference.path, reference } });
    if (reference.name && reference.name !== reference.path) {
      const nameStart = content.indexOf(reference.name, cursor);
      if (nameStart >= 0 && isFileBoundary(content, nameStart, reference.name.length)) candidates.push({ index: nameStart, length: reference.name.length, token: { kind: 'file', path: reference.path, reference: { ...reference, name: reference.name } } });
      const mention = `@${reference.mention ?? reference.name}`;
      const mentionStart = content.indexOf(mention, cursor);
      if (mentionStart >= 0 && isFileBoundary(content, mentionStart, mention.length)) candidates.push({ index: mentionStart, length: mention.length, token: { kind: 'file', path: reference.path, reference: { ...reference, name: reference.name } } });
    }
  }
  for (const match of content.slice(cursor).matchAll(/https?:\/\/[^\s<>()]+/giu)) {
    const raw = match[0];
    const url = trimUrlPunctuation(raw);
    if (url.length > 0) candidates.push({ index: cursor + (match.index ?? 0), length: url.length, token: { kind: 'url', url } });
  }
  if (highlightPromptTokens) {
    for (const match of content.slice(cursor).matchAll(/(?:@[^\s]+|\/[A-Za-z0-9][^\s]*)/gu)) {
      const value = match[0];
      if (value !== undefined) candidates.push({ index: cursor + (match.index ?? 0), length: value.length, token: { kind: 'prompt', value } });
    }
  }
  return candidates.sort((left, right) => left.index - right.index || right.length - left.length)[0];
}

function mergeFileReferences(references: readonly MessageFileReference[], extractedReferences: readonly MessageFileReference[]): MessageFileReference[] {
  const byPath = new Map<string, MessageFileReference>();
  for (const reference of [...references, ...extractedReferences]) {
    if (reference.path.length > 0 && !byPath.has(reference.path)) byPath.set(reference.path, reference);
  }
  return [...byPath.values()].sort((left, right) => right.path.length - left.path.length);
}

function extractAbsoluteFilePaths(content: string): string[] {
  const matches = content.matchAll(/(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))[^<>`\r\n]*?\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}(?=$|[\s),.;:!?])/gu);
  return [...matches].map(match => match[0]!.trim()).filter(path => !/^https?:/iu.test(path) && isAbsoluteFilePath(path));
}

function extractMentionedFileReferences(content: string, workspaceCwd?: string): MessageFileReference[] {
  if (workspaceCwd === undefined) return [];
  return [...content.matchAll(/@([^\s]+)/gu)].flatMap(match => {
    const name = trimFilePunctuation(match[1] ?? '');
    return isFileName(name) ? [{ path: resolveWorkspacePath(name, workspaceCwd), name: fileName(name), mention: name }] : [];
  });
}

function extractBareFileReferences(content: string, workspaceCwd?: string): MessageFileReference[] {
  if (workspaceCwd === undefined) return [];
  return [...content.matchAll(/[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}/gu)].flatMap(match => {
    const index = match.index ?? -1;
    const before = index > 0 ? content[index - 1] : undefined;
    const after = content[index + match[0].length];
    if (before === '/' || before === ':' || after === '/') return [];
    const name = trimFilePunctuation(match[0]);
    return isLikelyFileName(name) ? [{ path: resolveWorkspacePath(name, workspaceCwd), name: fileName(name), mention: name }] : [];
  });
}

function isFileBoundary(content: string, start: number, length: number): boolean {
  const before = content[start - 1];
  const after = content[start + length];
  return (before === undefined || !/[A-Za-z0-9_.-]/u.test(before)) && (after === undefined || !/[A-Za-z0-9_.-]/u.test(after));
}

function fileName(path: string): string { return path.split(/[\\/]/u).pop() ?? path; }
function trimFilePunctuation(value: string): string { return value.replace(/[.,;:!?]+$/u, '').replace(/[)]$/u, character => value.includes('(') ? character : ''); }
function isFileName(value: string): boolean { return /^(?:[^<>:"/\\|?*]+[\\/])*(?:[^<>:"/\\|?*]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}|\.[A-Za-z0-9][A-Za-z0-9_-]{0,31})$/u.test(value); }
function isLikelyFileName(value: string): boolean {
  if (!isFileName(value)) return false;
  const baseName = value.split(/[\\/]/u).pop() ?? value;
  if (baseName.startsWith('.')) return true;
  if (isNumericToken(baseName)) return false;
  const extensionIndex = baseName.lastIndexOf('.');
  const stem = baseName.slice(0, extensionIndex);
  const extension = baseName.slice(extensionIndex + 1);
  if (/^\d+$/u.test(stem) && /^\d+$/u.test(extension)) return false;
  return !isCommonWebDomain(value);
}

function isNumericToken(value: string): boolean {
  return /^[+-]?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)$/u.test(value);
}

function isCommonWebDomain(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return false;
  const extension = value.split('.').pop()?.toLocaleLowerCase();
  return extension !== undefined && ['com', 'org', 'net', 'io', 'ai', 'app', 'dev', 'co', 'me', 'tv', 'edu', 'gov', 'uk', 'de', 'fr', 'jp', 'ly', 'fm', 'gg', 'xyz', 'info', 'biz', 'site', 'tech'].includes(extension);
}
function isAbsolutePath(path: string): boolean { return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(path); }
function isAbsoluteFilePath(path: string): boolean {
  const baseName = fileName(path);
  return !baseName.startsWith('.') && isLikelyFileName(baseName);
}
function trimUrlPunctuation(value: string): string { return value.replace(/[.,;:!?]+$/u, '').replace(/[)]$/u, character => value.includes('(') ? character : ''); }
function faviconUrl(href: string): string { const url = new URL(href); return new URL('/favicon.ico', url.origin).toString(); }
function faviconProxyUrl(href: string): string { const url = new URL(href); return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url.origin)}&sz=32`; }
function websiteLabel(href: string): string { return new URL(href).hostname.replace(/^www\./iu, ''); }
function textContent(value: ReactNode): string { return Children.toArray(value).filter((item): item is string => typeof item === 'string').join('').trim(); }

type MessageToken = { kind: 'text'; value: string } | { kind: 'file'; path: string; reference: MessageFileReference } | { kind: 'url'; url: string } | { kind: 'prompt'; value: string };

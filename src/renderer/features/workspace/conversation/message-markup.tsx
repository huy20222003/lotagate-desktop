import { Children, useState, type ReactNode } from 'react';
import { Globe2 } from 'lucide-react';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { Icon, Tooltip } from '../../../components/ui.js';
import { fileIconFor } from '../../../components/file-icon.js';
import { openFilePath } from '../../../services/open-file.js';

export interface MessageFileReference {
  path: string;
  name?: string;
  kind?: Artifact['kind'] | 'folder';
  mention?: string;
}

export function resolveWorkspacePath(path: string, workspaceCwd?: string): string {
  if (workspaceCwd === undefined || isAbsolutePath(path)) return path;
  const separator = workspaceCwd.includes('\\') ? '\\' : '/';
  const relativePath = path.replace(/^\.([\\/])/u, '').replace(/[\\/]+/gu, separator);
  return `${workspaceCwd.replace(/[\\/]+$/u, '')}${separator}${relativePath}`;
}

export function MessageMarkup({ content, fileReferences = [], workspaceCwd, executionCwd, highlightPromptTokens = false }: { content: string; fileReferences?: readonly MessageFileReference[]; workspaceCwd?: string; executionCwd?: string; highlightPromptTokens?: boolean }): ReactNode {
  const taggedFileReferences = highlightPromptTokens ? extractTaggedFileReferences(content, workspaceCwd) : [];
  const references = mergeFileReferences([...fileReferences, ...taggedFileReferences], extractAbsoluteFilePaths(content).map(path => ({ path })), workspaceCwd, executionCwd);
  const tokens = tokenizeMessage(content, references, highlightPromptTokens);
  return <>{tokens.map((token, index) => token.kind === 'text' ? <span key={`text:${index}`}>{token.value}</span> : token.kind === 'file' ? <MessageFileLink key={`file:${token.path}:${index}`} reference={token.reference} /> : token.kind === 'prompt' ? <span className="prompt-token" key={`prompt:${index}`}>{token.value}</span> : <MessageExternalLink key={`url:${token.url}:${index}`} href={token.url} />)}</>;
}

export function MessageExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  const parsed = parseExternalUrl(href);
  if (parsed === undefined) return <span>{children ?? href}</span>;
  const label = textContent(children) || websiteLabel(href);
  return <Tooltip label={parsed.toString()}><a className="message-external-link" href={parsed.toString()} target="_blank" rel="noreferrer"><MessageLinkIcon url={parsed} /><span>{label}</span></a></Tooltip>;
}

function MessageLinkIcon({ url }: { url: URL }) {
  const [failed, setFailed] = useState(false);
  if (!failed) return <img className="message-link-favicon" src={`${url.origin}/favicon.ico`} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return <Icon icon={Globe2} size={13} />;
}

function MessageFileLink({ reference }: { reference: MessageFileReference }) {
  const name = fileName(reference.path);
  const FileIcon = fileIconFor({ name, kind: reference.kind });
  return <Tooltip label={displayPath(reference.path)}><a className="message-file-reference" href="#open-file" onClick={event => { event.preventDefault(); openFilePath(reference.path); }}><Icon icon={FileIcon} size={14} /><span>{name}</span></a></Tooltip>;
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
    const matchPaths = [...new Set([reference.mention, reference.path].filter((value): value is string => value !== undefined))];
    for (const matchPath of matchPaths) {
      const start = content.indexOf(matchPath, cursor);
      if (start >= 0 && isFileBoundary(content, start, matchPath.length)) candidates.push({ index: start, length: matchPath.length, token: { kind: 'file', path: matchPath, reference } });
    }
  }
  for (const match of content.slice(cursor).matchAll(/https?:\/\/[^\s<>()]+/giu)) {
    const raw = match[0];
    const url = trimUrlPunctuation(raw);
    if (url.length > 0 && parseExternalUrl(url) !== undefined) candidates.push({ index: cursor + (match.index ?? 0), length: url.length, token: { kind: 'url', url } });
  }
  for (const match of content.slice(cursor).matchAll(BARE_DOMAIN_PATTERN)) {
    const raw = match[0];
    const url = trimUrlPunctuation(raw);
    if (url.length > 0 && parseExternalUrl(url) !== undefined) candidates.push({ index: cursor + (match.index ?? 0), length: url.length, token: { kind: 'url', url } });
  }
  if (highlightPromptTokens) {
    for (const match of content.slice(cursor).matchAll(/(?:@[^\s]+|\/[A-Za-z0-9][^\s]*)/gu)) {
      const value = match[0];
      if (value !== undefined) candidates.push({ index: cursor + (match.index ?? 0), length: value.length, token: { kind: 'prompt', value } });
    }
  }
  return candidates.sort((left, right) => left.index - right.index || right.length - left.length)[0];
}

function mergeFileReferences(references: readonly MessageFileReference[], extractedReferences: readonly MessageFileReference[], workspaceCwd?: string, executionCwd?: string): MessageFileReference[] {
  const byPath = new Map<string, MessageFileReference>();
  for (const reference of [...references, ...extractedReferences]) {
    if (!isAbsoluteFilePath(reference.path) && reference.kind !== 'folder') continue;
    const displayPath = projectPathForDisplay(reference.path, workspaceCwd, executionCwd);
    const normalized = displayPath === reference.path ? reference : { ...reference, path: displayPath, mention: reference.mention ?? reference.path };
    if (!byPath.has(normalized.path)) byPath.set(normalized.path, normalized);
  }
  return [...byPath.values()].sort((left, right) => right.path.length - left.path.length);
}

function extractAbsoluteFilePaths(content: string): string[] {
  const matches = content.matchAll(/(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))[^<>`\r\n]*?\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}(?=$|[\s),.;:!?])/gu);
  return [...matches].map(match => match[0]!.trim()).filter(path => !/^https?:/iu.test(path) && isAbsoluteFilePath(path));
}

function extractTaggedFileReferences(content: string, workspaceCwd?: string): MessageFileReference[] {
  if (workspaceCwd === undefined) return [];
  const references: MessageFileReference[] = [];
  for (const match of content.matchAll(/(?:^|\s)(@[^\s@]+)/gu)) {
    const mention = match[1];
    if (mention === undefined) continue;
    const path = resolveWorkspacePath(mention.slice(1), workspaceCwd);
    if (!isAbsolutePath(path)) continue;
    references.push({ path, mention, ...(isAbsoluteFilePath(path) ? {} : { kind: 'folder' }) });
  }
  return references;
}

function isFileBoundary(content: string, start: number, length: number): boolean {
  const before = content[start - 1];
  const after = content[start + length];
  return (before === undefined || !/[A-Za-z0-9_.-]/u.test(before)) && (after === undefined || !/[A-Za-z0-9_.-]/u.test(after));
}

function fileName(path: string): string { return path.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() ?? path; }
function displayPath(path: string): string { return path.replace(/\\/gu, '/'); }
function isAbsolutePath(path: string): boolean { return /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/u.test(path); }
function isAbsoluteFilePath(path: string): boolean {
  if (!isAbsolutePath(path)) return false;
  const baseName = fileName(path);
  return !baseName.startsWith('.') && /[^<>:"/\\|?*]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/u.test(baseName);
}
const BARE_DOMAIN_PATTERN = /(?<![@A-Za-z0-9_.-])(?:www\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s<>()]*)?/giu;
const COMMON_WEB_TLDS = new Set(['ai', 'app', 'au', 'biz', 'ca', 'cloud', 'co', 'cn', 'com', 'de', 'dev', 'edu', 'fm', 'fr', 'gg', 'gov', 'in', 'info', 'io', 'jp', 'ly', 'me', 'mil', 'net', 'online', 'org', 'site', 'store', 'tech', 'tv', 'uk', 'us', 'vn', 'xyz']);
function trimUrlPunctuation(value: string): string { return value.replace(/[.,;:!?]+$/u, '').replace(/[)]$/u, character => value.includes('(') ? character : ''); }
export function parseExternalUrl(href: string): URL | undefined {
  const candidate = href.trim();
  const isBareDomain = !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(candidate);
  const normalized = isBareDomain ? `https://${candidate}` : candidate;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (isBareDomain && !COMMON_WEB_TLDS.has(url.hostname.split('.').at(-1)?.toLowerCase() ?? '')) return undefined;
    return url;
  } catch { return undefined; }
}
function websiteLabel(href: string): string { return parseExternalUrl(href)?.hostname.replace(/^www\./iu, '') ?? href; }
function textContent(value: ReactNode): string { return Children.toArray(value).filter((item): item is string => typeof item === 'string').join('').trim(); }

function projectPathForDisplay(path: string, projectRoot?: string, executionCwd?: string): string {
  if (projectRoot === undefined || executionCwd === undefined || !isAbsolutePath(path)) return path;
  const relativePath = relativePathIfInside(path, executionCwd);
  if (relativePath === undefined) return path;
  return joinWorkspacePath(projectRoot, relativePath);
}

function relativePathIfInside(candidate: string, root: string): string | undefined {
  const normalizedCandidate = candidate.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const normalizedRoot = root.replace(/\\/gu, '/').replace(/\/+$/u, '');
  const candidateKey = normalizedCandidate.toLowerCase();
  const rootKey = normalizedRoot.toLowerCase();
  if (candidateKey === rootKey) return '';
  if (!candidateKey.startsWith(`${rootKey}/`)) return undefined;
  return normalizedCandidate.slice(normalizedRoot.length + 1);
}

function joinWorkspacePath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/u, '')}${separator}${relativePath.replace(/[\\/]+/gu, separator)}`;
}

type MessageToken = { kind: 'text'; value: string } | { kind: 'file'; path: string; reference: MessageFileReference } | { kind: 'url'; url: string } | { kind: 'prompt'; value: string };

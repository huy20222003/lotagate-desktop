import { createElement } from 'react';
import { Atom, Braces, FileArchive, FileAudio, FileCode2, FileCog, FileDiff, FileImage, FileJson, FileSpreadsheet, FileTerminal, FileText, FileType2, FileVideo, Folder, Presentation } from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import type { Artifact } from '../../contracts/ipc/v1/workspace.js';

type FileIconInput = { name: string; kind?: Artifact['kind'] | 'folder' | undefined };

const icons = {
  archive: withTone(FileArchive, 'archive'),
  audio: withTone(FileAudio, 'media'),
  code: withTone(FileCode2, 'code'),
  config: withTone(FileCog, 'config'),
  data: withTone(FileJson, 'data'),
  diff: withTone(FileDiff, 'code'),
  folder: withTone(Folder, 'folder'),
  document: withTone(FileText, 'document'),
  image: withTone(FileImage, 'media'),
  javascript: withTone(Braces, 'javascript'),
  presentation: withTone(Presentation, 'presentation'),
  react: withTone(Atom, 'react'),
  spreadsheet: withTone(FileSpreadsheet, 'spreadsheet'),
  terminal: withTone(FileTerminal, 'terminal'),
  typescript: withTone(FileType2, 'typescript'),
  video: withTone(FileVideo, 'media'),
};

export function fileIconFor({ name, kind }: FileIconInput): LucideIcon {
  if (kind === 'folder') return icons.folder;
  const extension = fileExtension(name);

  if (kind === 'image' || isExtension(extension, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'])) return icons.image;
  if (kind === 'video' || isExtension(extension, ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])) return icons.video;
  if (kind === 'audio' || isExtension(extension, ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'])) return icons.audio;
  if (kind === 'patch') return icons.diff;

  if (isExtension(extension, ['tsx', 'jsx'])) return icons.react;
  if (isExtension(extension, ['ts', 'mts', 'cts'])) return icons.typescript;
  if (isExtension(extension, ['js', 'mjs', 'cjs'])) return icons.javascript;
  if (isExtension(extension, ['html', 'htm', 'xml', 'svg', 'css', 'scss', 'less', 'sass'])) return icons.code;
  if (isExtension(extension, ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'])) return icons.terminal;
  if (isExtension(extension, ['py', 'java', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'c', 'cpp', 'h', 'hpp'])) return icons.code;
  if (kind === 'json' || isExtension(extension, ['json', 'jsonl'])) return icons.data;
  if (isExtension(extension, ['yaml', 'yml', 'toml', 'ini', 'conf', 'config']) || isDotFile(extension, ['env', 'gitignore', 'dockerignore', 'editorconfig'])) return icons.config;
  if (isExtension(extension, ['csv', 'tsv', 'xls', 'xlsx'])) return icons.spreadsheet;
  if (isExtension(extension, ['ppt', 'pptx', 'odp'])) return icons.presentation;
  if (isExtension(extension, ['zip', 'gz', 'tar', 'rar', '7z'])) return icons.archive;
  if (isExtension(extension, ['md', 'txt', 'log', 'doc', 'docx', 'odt', 'pdf'])) return icons.document;
  return icons.document;
}

function withTone(icon: LucideIcon, tone: string): LucideIcon {
  const TypedIcon = ({ className, ...props }: LucideProps) => createElement(icon, {
    ...props,
    className: [className, 'file-icon', `file-icon-${tone}`].filter(Boolean).join(' '),
  });
  return TypedIcon as unknown as LucideIcon;
}

function isExtension(extension: string | undefined, extensions: readonly string[]): boolean {
  return extension !== undefined && extensions.includes(extension);
}

function isDotFile(extension: string | undefined, names: readonly string[]): boolean {
  return extension !== undefined && names.includes(extension);
}

function fileExtension(name: string): string | undefined {
  const baseName = name.split(/[\\/]/u).pop() ?? name;
  const extension = baseName.includes('.') ? baseName.split('.').pop()?.toLocaleLowerCase() : undefined;
  return extension === undefined || extension.length === 0 ? undefined : extension;
}

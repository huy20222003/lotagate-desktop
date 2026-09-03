import { dialog } from 'electron';
import { stat, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { z } from 'zod';
import { assertTrustedRenderer } from './sender-policy.js';
import { requireDirectory, requireExistingPath } from '../security/path-policy.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerWorkspaceIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, workspaces, workspaceFileSuggestions, tasks, checkpoints, requireWorkspaceCwd, cwdSchema, idSchema, objectSchema, services } = context;
handle('workspace.list', async event => { assertTrustedRenderer(event); return workspaces.list(); });
handle('workspace.pickFolder', async (event, rootPath?: unknown) => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const selected = await dialog.showOpenDialog({ ...(scope === undefined ? {} : { defaultPath: scope }), properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || selected.filePaths[0] === undefined) return null;
    return scope === undefined ? selected.filePaths[0] : relative(scope, await requireExistingPath(selected.filePaths[0], scope)) || '.';
  });
  const parseFileExtensions = (extensions: unknown): string[] => extensions === undefined ? [] : z.array(z.string().regex(/^[a-z0-9]+$/iu).max(16)).max(32).parse(extensions).map(extension => extension.toLowerCase());
  const resolvePickedFile = async (filePath: string, scope: string | undefined): Promise<string> => {
    const file = scope === undefined
      ? await realpath(isAbsolute(filePath) ? filePath : (() => { throw new Error('Selected file must use an absolute path.'); })())
      : await requireExistingPath(filePath, scope);
    const details = await stat(file);
    if (!details.isFile()) throw new Error('Selected path must be a file.');
    return file;
  };
  const pickFiles = async (event: Electron.IpcMainInvokeEvent, rootPath: unknown, extensions: unknown, multiSelections: boolean): Promise<string[]> => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const allowedExtensions = parseFileExtensions(extensions);
    const properties: Array<'openFile' | 'multiSelections'> = multiSelections ? ['openFile', 'multiSelections'] : ['openFile'];
    const selected = await dialog.showOpenDialog({ ...(scope === undefined ? {} : { defaultPath: scope }), properties, ...(allowedExtensions.length === 0 ? {} : { filters: [{ name: 'Supported files', extensions: allowedExtensions }] }) });
    if (selected.canceled) return [];
    const files = await Promise.all(selected.filePaths.map(filePath => resolvePickedFile(filePath, scope)));
    for (const file of files) {
      const extension = extname(file).slice(1).toLowerCase();
      if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) throw new Error(`Select a file with one of these extensions: ${allowedExtensions.join(', ')}.`);
    }
    return scope === undefined ? files : files.map(file => relative(scope, file));
  };
handle('workspace.pickFile', async (event, rootPath?: unknown, extensions?: unknown) => { const files = await pickFiles(event, rootPath, extensions, false); return files[0] ?? null; });
handle('workspace.pickMultipleFile', async (event, rootPath?: unknown, extensions?: unknown) => pickFiles(event, rootPath, extensions, true));
handle('workspace.pickSaveFile', async (event, rootPath?: unknown, extensions?: unknown) => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const allowedExtensions = parseFileExtensions(extensions);
    const selected = await dialog.showSaveDialog({ ...(scope === undefined ? {} : { defaultPath: scope }), ...(allowedExtensions.length === 0 ? {} : { filters: [{ name: 'Supported files', extensions: allowedExtensions }] }) });
    if (selected.canceled || selected.filePath === undefined) return null;
    const selectedPath = await realpath(selected.filePath).catch(() => selected.filePath);
    const selectedExtension = extname(selectedPath).slice(1).toLowerCase();
    const file = allowedExtensions.length > 0 && selectedExtension === '' ? `${selectedPath}.${allowedExtensions[0]}` : selectedPath;
    if (!isAbsolute(file)) throw new Error('Selected file must use an absolute path.');
    if (allowedExtensions.length > 0 && !allowedExtensions.includes(extname(file).slice(1).toLowerCase())) throw new Error(`Save the file with one of these extensions: ${allowedExtensions.join(', ')}.`);
    if (scope === undefined) return file;
    const scopedPath = relative(scope, file);
    if (scopedPath === '..' || scopedPath.startsWith(`..${sep}`) || isAbsolute(scopedPath)) throw new Error('Selected file must remain inside the workspace.');
    return scopedPath || '.';
  });
handle('workspace.fileSize', async (event, rootPath: unknown, filePath: unknown) => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const file = await resolvePickedFile(z.string().min(1).max(4_096).parse(filePath), scope);
    return (await stat(file)).size;
  });
handle('workspace.add', async (event, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.add(cwdSchema.parse(rootPath)); });
handle('workspace.addRoot', async (event, workspaceId: unknown, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.addRoot(idSchema.parse(workspaceId), cwdSchema.parse(rootPath)); });
handle('workspace.rename', async (event, workspaceId: unknown, name: unknown) => { assertTrustedRenderer(event); return workspaces.rename(idSchema.parse(workspaceId), z.string().parse(name)); });
handle('workspace.reorder', async (event, ids: unknown) => { assertTrustedRenderer(event); return workspaces.reorder(z.array(idSchema).parse(ids)); });
handle('workspace.settings', async (event, workspaceId: unknown, patch: unknown) => { assertTrustedRenderer(event); return workspaces.updateSettings(idSchema.parse(workspaceId), objectSchema.parse(patch)); });
handle('workspace.remove', async (event, workspaceId: unknown) => {
    assertTrustedRenderer(event);
    const workspace = await workspaces.require(idSchema.parse(workspaceId));
    await services.onWorkspaceRemoved?.(workspace);
    return workspaces.remove(workspace.id);
  });
handle('workspace.trust', async (event, workspaceId: unknown, trusted: unknown) => { assertTrustedRenderer(event); return workspaces.trust(idSchema.parse(workspaceId), z.boolean().parse(trusted)); });
handle('workspace.fileSuggestions', async (event, rootPath: unknown, query: unknown) => { assertTrustedRenderer(event); return workspaceFileSuggestions.list(await requireWorkspaceCwd(rootPath), z.string().max(256).parse(query)); });
handle('checkpoint.list', async (event, cwd: unknown, taskId: unknown) => { assertTrustedRenderer(event); const canonicalCwd = await requireWorkspaceCwd(cwd); const task = await tasks.requireForCwd(idSchema.parse(taskId), canonicalCwd); return checkpoints.list(canonicalCwd, task.id); });
handle('checkpoint.undo', async (event, cwd: unknown, taskId: unknown, turnId: unknown) => { assertTrustedRenderer(event); const canonicalCwd = await requireWorkspaceCwd(cwd); const task = await tasks.requireForCwd(idSchema.parse(taskId), canonicalCwd); return checkpoints.undo(canonicalCwd, task.id, idSchema.parse(turnId)); });
}

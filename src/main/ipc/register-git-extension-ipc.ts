import { z } from 'zod';
import { assertTrustedRenderer } from './sender-policy.js';
import { extensionDetailInputSchema, extensionDetailWriteInputSchema, hookCreateInputSchema, hookRemoveInputSchema } from '../../contracts/ipc/v1/extensions-schema.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerGitExtensionIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, extensionFiles, git, requireWorkspaceCwd, cwdSchema } = context;
handle('extension.readDetail', async (event, input: unknown) => { assertTrustedRenderer(event); return extensionFiles.readDetail(extensionDetailInputSchema.parse(input)); });
handle('extension.writeDetail', async (event, input: unknown) => { assertTrustedRenderer(event); await extensionFiles.writeDetail(extensionDetailWriteInputSchema.parse(input)); });
handle('extension.listProjectHooks', async (event, cwd: unknown) => { assertTrustedRenderer(event); return extensionFiles.listProjectHooks(await requireWorkspaceCwd(cwd)); });
handle('extension.createHook', async (event, input: unknown) => { assertTrustedRenderer(event); return extensionFiles.createHook(hookCreateInputSchema.parse(input)); });
handle('extension.removeHook', async (event, input: unknown) => { assertTrustedRenderer(event); await extensionFiles.removeHook(hookRemoveInputSchema.parse(input)); });
handle('git.status', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.status(await requireWorkspaceCwd(cwd)); });
handle('git.diff', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.diff(await requireWorkspaceCwd(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
handle('git.fileDiff', async (event, cwd: unknown, path: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.fileDiff(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), staged === undefined ? false : z.boolean().parse(staged)); });
handle('git.readFile', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.readFile(await requireWorkspaceCwd(cwd), cwdSchema.parse(path)); });
handle('git.branches', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.branches(await requireWorkspaceCwd(cwd)); });
handle('git.branchList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.branchList(await requireWorkspaceCwd(cwd)); });
handle('git.stage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.stage(await requireWorkspaceCwd(cwd), cwdSchema.parse(path)); });
handle('git.stageAll', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.stageAll(await requireWorkspaceCwd(cwd)); });
handle('git.unstage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.unstage(await requireWorkspaceCwd(cwd), cwdSchema.parse(path)); });
handle('git.unstageAll', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.unstageAll(await requireWorkspaceCwd(cwd)); });
handle('git.commit', async (event, cwd: unknown, message: unknown) => { assertTrustedRenderer(event); return git.commit(await requireWorkspaceCwd(cwd), z.string().parse(message)); });
handle('git.createBranch', async (event, cwd: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.createBranch(await requireWorkspaceCwd(cwd), z.string().parse(branch)); });
handle('git.checkout', async (event, cwd: unknown, branch: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.checkout(await requireWorkspaceCwd(cwd), z.string().parse(branch), z.boolean().parse(confirmed)); });
handle('git.fetch', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.fetch(await requireWorkspaceCwd(cwd)); });
handle('git.pull', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.pull(await requireWorkspaceCwd(cwd)); });
handle('git.push', async (event, cwd: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.push(await requireWorkspaceCwd(cwd), z.boolean().parse(confirmed)); });
handle('git.history', async (event, cwd: unknown, limit?: unknown) => { assertTrustedRenderer(event); return git.history(await requireWorkspaceCwd(cwd), limit === undefined ? undefined : z.number().int().min(1).max(200).parse(limit)); });
handle('git.stashList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.stashList(await requireWorkspaceCwd(cwd)); });
handle('git.stashSave', async (event, cwd: unknown, message?: unknown) => { assertTrustedRenderer(event); return git.stashSave(await requireWorkspaceCwd(cwd), message === undefined ? undefined : z.string().max(500).parse(message)); });
handle('git.stashApply', async (event, cwd: unknown, reference: unknown) => { assertTrustedRenderer(event); return git.stashApply(await requireWorkspaceCwd(cwd), z.string().parse(reference)); });
handle('git.stashDrop', async (event, cwd: unknown, reference: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.stashDrop(await requireWorkspaceCwd(cwd), z.string().parse(reference), z.boolean().parse(confirmed)); });
handle('git.exportPatch', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.exportPatch(await requireWorkspaceCwd(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
handle('git.worktreeAdd', async (event, cwd: unknown, path: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.worktreeAdd(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), z.string().parse(branch)); });
handle('git.worktreeRemove', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.worktreeRemove(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
handle('git.restore', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.restore(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
}

import { z } from 'zod';
import type { LoginInput } from '../../contracts/ipc/v1/auth.js';
import { assertTrustedRenderer } from './sender-policy.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerCoreIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, setMenuContext, auth, userContext, idSchema, paginationPageSchema, paginationLimitSchema } = context;
handle('menu.setContext', async (event, context: unknown) => {
    assertTrustedRenderer(event);
    setMenuContext(z.enum(['login', 'workspace']).parse(context));
  });
handle('auth.getCurrentUser', async (event) => {
    assertTrustedRenderer(event);
    return auth.getCurrentUser();
  });
handle('auth.restoreSession', async (event) => {
    assertTrustedRenderer(event);
    return auth.restoreSession();
  });
handle('auth.login', async (event, input: LoginInput) => {
    assertTrustedRenderer(event);
    return auth.login(input);
  });
handle('auth.logout', async (event) => {
    assertTrustedRenderer(event);
    return auth.logout();
  });
handle('userContext.organizations', async event => { assertTrustedRenderer(event); return userContext.organizations(); });
handle('userContext.organization', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.organization(idSchema.parse(code)); });
handle('userContext.wallet', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.wallet(idSchema.parse(code)); });
handle('userContext.usage', async (event, organizationCode: unknown, workspaceCode?: unknown) => { assertTrustedRenderer(event); return userContext.usage(idSchema.parse(organizationCode), workspaceCode === undefined ? undefined : idSchema.parse(workspaceCode)); });
handle('userContext.dashboardStats', async (event, organizationCode: unknown, workspaceCode?: unknown) => { assertTrustedRenderer(event); return userContext.dashboardStats(idSchema.parse(organizationCode), workspaceCode === undefined ? undefined : idSchema.parse(workspaceCode)); });
handle('userContext.paymentHistory', async (event, organizationCode: unknown, page?: unknown, limit?: unknown) => { assertTrustedRenderer(event); return userContext.paymentHistory(idSchema.parse(organizationCode), page === undefined ? 1 : paginationPageSchema.parse(page), limit === undefined ? 10 : paginationLimitSchema.parse(limit)); });
handle('userContext.workspaces', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.workspaces(idSchema.parse(code)); });
handle('userContext.models', async (event, organizationCode: unknown, workspaceCode: unknown) => { assertTrustedRenderer(event); return userContext.models(idSchema.parse(organizationCode), idSchema.parse(workspaceCode)); });
handle('runtime.getVersion', async (event) => {
    assertTrustedRenderer(event);
    return process.env['npm_package_version'] ?? '0.1.0';
  });
}

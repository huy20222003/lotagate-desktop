import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { launchDesktop, type DesktopAppFixture } from './support/desktop-app.js';

const username = process.env['LOTAGATE_E2E_USERNAME'];
const password = process.env['LOTAGATE_E2E_PASSWORD'];
const apiKey = process.env['LOTAGATE_E2E_API_KEY'] ?? process.env['LOTAGATE_TEST_API_KEY'] ?? process.env['LOTAGATE_API_KEY'];
const apiBaseUrl = process.env['LOTAGATE_E2E_API_BASE_URL'] ?? 'https://api.lotagate.com/api/v1';
const model = process.env['LOTAGATE_E2E_MODEL'] ?? 'deepseek-v4-flash';
const canRunRealMessageTest = [username, password, apiKey].every(value => typeof value === 'string' && value.trim().length > 0);

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.describe('Desktop real message requests', () => {
  test.skip(!canRunRealMessageTest, 'Set LOTAGATE_E2E_USERNAME, LOTAGATE_E2E_PASSWORD and LOTAGATE_TEST_API_KEY (or LOTAGATE_E2E_API_KEY) before running.');

  test('sends a real no-tool message', async () => {
    const fixture = await openWorkspace();
    try {
      await signIn(fixture.page);
      await startChat(fixture.page);
      await sendPrompt(fixture.page, 'Do not call any tool. Reply with exactly: desktop-no-tool-ok');
      await expect(fixture.page.getByText('desktop-no-tool-ok', { exact: true })).toBeVisible({ timeout: 75_000 });
      await expectIdle(fixture.page);
    } finally {
      await fixture.close();
    }
  });

  test('sends a real message that invokes shell.exec', async () => {
    const fixture = await openWorkspace();
    try {
      await signIn(fixture.page);
      await startChat(fixture.page);
      await sendPrompt(fixture.page, `Use shell.exec exactly once to run node -e "process.stdout.write('desktop-shell-ok')". Then report the exact output.`);
      await acceptTrustAndApproval(fixture.page);
      await expect(fixture.page.getByText('desktop-shell-ok', { exact: true })).toBeVisible({ timeout: 90_000 });
      await expectIdle(fixture.page);
    } finally {
      await fixture.close();
    }
  });

  test('sends a real command request without simulating its output', async () => {
    const fixture = await openWorkspace();
    try {
      await signIn(fixture.page);
      await startChat(fixture.page);
      await sendPrompt(fixture.page, `Run the real command node -e "process.stdout.write('desktop-command-ok')" using shell.exec. Do not simulate it. Report its exact output.`);
      await acceptTrustAndApproval(fixture.page);
      await expect(fixture.page.getByText('desktop-command-ok', { exact: true })).toBeVisible({ timeout: 90_000 });
      await expectIdle(fixture.page);
    } finally {
      await fixture.close();
    }
  });
});

async function openWorkspace(): Promise<DesktopAppFixture> {
  let projectPath = '';
  const fixture = await launchDesktop(async ({ userDataDir, cliHome }) => {
    projectPath = await mkdtemp(join(tmpdir(), 'lotagate-desktop-message-test-'));
    await mkdir(join(projectPath, 'src'), { recursive: true });
    await writeFile(join(projectPath, 'README.md'), '# Desktop message test\n', 'utf8');
    await seedWorkspace(userDataDir, projectPath);
    await seedCliSettings(cliHome);
  });
  const close = fixture.close;
  fixture.close = async () => { await close(); await rm(projectPath, { recursive: true, force: true }); };
  return fixture;
}

async function seedWorkspace(userDataDir: string, projectPath: string): Promise<void> {
  const now = new Date().toISOString();
  await mkdir(join(userDataDir, 'desktop-data'), { recursive: true });
  await writeFile(join(userDataDir, 'desktop-data', 'workspaces.json'), `${JSON.stringify([{
    id: `desktop-message-test-${randomUUID()}`,
    name: 'desktop-message-test',
    rootPath: projectPath,
    roots: [projectPath],
    trusted: false,
    settings: {},
    createdAt: now,
    lastOpenedAt: now,
  }])}\n`, 'utf8');
}

async function seedCliSettings(cliHome: string): Promise<void> {
  await mkdir(join(cliHome, '.lotagate'), { recursive: true });
  await writeFile(join(cliHome, '.lotagate', 'settings.json'), `${JSON.stringify({ schemaVersion: 1, baseUrl: apiBaseUrl, model, approvalMode: 'ask', sandboxMode: 'disabled', memoryContext: 'disabled' })}\n`, 'utf8');
}

async function signIn(page: Page): Promise<void> {
  await page.getByLabel(/Email or username|Email hoặc tên đăng nhập/u).fill(username!);
  await page.getByLabel(/Password|Mật khẩu/u).fill(password!);
  await page.getByRole('button', { name: /Sign in|Đăng nhập/u }).click();
  await expect(page.locator('.workspace-shell')).toBeVisible({ timeout: 45_000 });
}

async function startChat(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'New chat' }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeEnabled();
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Prompt' });
  await expect(input).toBeEnabled();
  await input.fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function acceptTrustAndApproval(page: Page): Promise<void> {
  const trust = page.getByRole('button', { name: 'Trust project' });
  if (await trust.isVisible({ timeout: 15_000 }).catch(() => false)) await trust.click();
  const allow = page.getByRole('button', { name: 'Yes, allow' });
  if (await allow.isVisible({ timeout: 15_000 }).catch(() => false)) await allow.click();
}

async function expectIdle(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Cancel response' })).toHaveCount(0);
}

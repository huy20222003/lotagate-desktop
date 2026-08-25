import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';

test('cold start presents the normal login screen', async () => {
  const packagedExecutable = process.env['LOTAGATE_ELECTRON_PATH'];
  const executable = packagedExecutable ?? resolve('out/lotagate-desktop-win32-x64/lotagate-desktop.exe');
  const args: string[] = [];
  const application = await electron.launch({
    executablePath: executable,
    args: [...args, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, LOTAGATE_API_BASE_URL: '', LOTAGATE_TRUSTED_ORIGIN: '' },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('heading', { name: /Sign in to continue|Đăng nhập để tiếp tục/u })).toBeVisible();
    await expect(page.getByLabel(/Email or username|Email hoặc tên đăng nhập/u)).toBeVisible();
    await expect(page.getByLabel(/Password|Mật khẩu/u)).toBeVisible();
    await expect.poll(() => application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map(item => item.label) ?? [])).toEqual([]);
  } finally { await application.close(); }
});

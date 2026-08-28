import { test, expect } from '@playwright/test';
import { launchDesktop } from './support/desktop-app.js';

test('cold start presents the normal login screen', async () => {
  const fixture = await launchDesktop();
  try {
    await expect(fixture.page.getByRole('heading', { name: /Sign in to continue|Đăng nhập để tiếp tục/u })).toBeVisible();
    await expect(fixture.page.getByLabel(/Email or username|Email hoặc tên đăng nhập/u)).toBeVisible();
    await expect(fixture.page.getByLabel(/Password|Mật khẩu/u)).toBeVisible();
    await expect.poll(() => fixture.application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map(item => item.label) ?? [])).toEqual([]);
  } finally {
    await fixture.close();
  }
});

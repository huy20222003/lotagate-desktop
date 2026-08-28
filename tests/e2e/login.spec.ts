import { test, expect } from '@playwright/test';
import { launchDesktop } from './support/desktop-app.js';

test.describe('login boundary', () => {
  test('keeps the login form on incomplete submission', async () => {
    const fixture = await launchDesktop();
    try {
      await fixture.page.getByRole('button', { name: /Sign in|Đăng nhập/u }).click();
      await expect(fixture.page.getByRole('heading', { name: /Sign in to continue|Đăng nhập để tiếp tục/u })).toBeVisible();
      await expect(fixture.page.getByLabel(/Email or username|Email hoặc tên đăng nhập/u)).toBeFocused();
    } finally {
      await fixture.close();
    }
  });

  test('supports password visibility without changing the submitted value', async () => {
    const fixture = await launchDesktop();
    try {
      const password = fixture.page.getByLabel(/Password|Mật khẩu/u);
      await password.fill('test-password');
      await expect(password).toHaveAttribute('type', 'password');
      await fixture.page.getByRole('button', { name: /Show password|Hiện mật khẩu/u }).click();
      await expect(password).toHaveAttribute('type', 'text');
      await expect(password).toHaveValue('test-password');
      await fixture.page.getByRole('button', { name: /Hide password|Ẩn mật khẩu/u }).click();
      await expect(password).toHaveAttribute('type', 'password');
    } finally {
      await fixture.close();
    }
  });

  test('surfaces an authentication error without leaving the login screen', async () => {
    const fixture = await launchDesktop();
    try {
      await fixture.page.getByLabel(/Email or username|Email hoặc tên đăng nhập/u).fill('user@example.com');
      await fixture.page.getByLabel(/Password|Mật khẩu/u).fill('test-password');
      await fixture.page.getByRole('button', { name: /Sign in|Đăng nhập/u }).click();
      await expect(fixture.page.getByRole('main').getByRole('alert')).toContainText(/DesktopAuthError:/u);
    } finally {
      await fixture.close();
    }
  });
});

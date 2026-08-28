import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export interface DesktopAppFixture {
  application: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

export async function launchDesktop(): Promise<DesktopAppFixture> {
  const packagedExecutable = process.env['LOTAGATE_ELECTRON_PATH'];
  const executable = packagedExecutable ?? resolve('out/lotagate-desktop-win32-x64/lotagate-desktop.exe');
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'lotagate-desktop-e2e-'));
  const application = await electron.launch({
    executablePath: executable,
    args: ['--disable-gpu', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, LOTAGATE_API_BASE_URL: '', LOTAGATE_TRUSTED_ORIGIN: '' },
  });
  const page = await application.firstWindow();
  return {
    application,
    page,
    close: async () => {
      await application.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

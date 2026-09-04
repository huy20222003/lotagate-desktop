import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export interface DesktopAppFixture {
  application: ElectronApplication;
  page: Page;
  userDataDir: string;
  cliHome: string;
  close: () => Promise<void>;
}

export interface DesktopAppLaunchContext {
  userDataDir: string;
  cliHome: string;
}

export async function launchDesktop(
  prepare?: (context: DesktopAppLaunchContext) => Promise<void>,
): Promise<DesktopAppFixture> {
  const packagedExecutable = process.env['LOTAGATE_ELECTRON_PATH'];
  const sourceRuntime = process.env['LOTAGATE_E2E_SOURCE_RUNTIME'] === '1';
  const executable = sourceRuntime ? resolve('node_modules/electron/dist/electron.exe') : packagedExecutable ?? resolve('out/lotagate-desktop-win32-x64/lotagate-desktop.exe');
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'lotagate-desktop-e2e-'));
  const cliHome = resolve(userDataDir, 'cli-home');
  const apiBaseUrl = process.env['LOTAGATE_E2E_API_BASE_URL'] ?? '';
  const trustedOrigin = process.env['LOTAGATE_E2E_TRUSTED_ORIGIN'] ?? '';
  const apiKey = process.env['LOTAGATE_E2E_API_KEY'] ?? process.env['LOTAGATE_TEST_API_KEY'] ?? process.env['LOTAGATE_API_KEY'];
  await prepare?.({ userDataDir, cliHome });
  const launchArgs = ['--disable-gpu', '--no-sandbox', `--user-data-dir=${userDataDir}`];
  const sourceRendererUrl = sourceRuntime ? pathToFileURL(resolve('out/renderer/index.html')).href : undefined;
  const application = await electron.launch({
    executablePath: executable,
    args: sourceRuntime ? [...launchArgs, resolve('.')] : launchArgs,
    env: { ...process.env, ...(sourceRendererUrl === undefined ? {} : { ELECTRON_RENDERER_URL: sourceRendererUrl }), ...(apiKey === undefined ? {} : { LOTAGATE_API_KEY: apiKey }), LOTAGATE_API_BASE_URL: apiBaseUrl, LOTAGATE_TRUSTED_ORIGIN: trustedOrigin, LOTAGATE_HOME: cliHome },
  });
  const page = await application.firstWindow();
  return {
    application,
    page,
    userDataDir,
    cliHome,
    close: async () => {
      await application.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

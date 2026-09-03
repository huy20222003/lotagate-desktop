import type { ForgeConfig } from '@electron-forge/shared-types';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerPKG } from '@electron-forge/maker-pkg';
import { MakerWix } from '@electron-forge/maker-wix';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { generateRuntimeConfigArtifact } from './scripts/runtime-config-artifact.mjs';

const installerResource = (fileName: string): string => resolve(process.cwd(), 'resources', 'installer', fileName);
const eulaPath = installerResource('eula.rtf');
const wixUiTemplate = readFileSync(installerResource('wix-ui.xml'), 'utf8');
const macInstallerIdentity = process.env['LOTAGATE_MAC_INSTALLER_IDENTITY']?.trim();
const runtimeConfigArtifact = generateRuntimeConfigArtifact(process.cwd());
const removePackagedSourceMaps = (buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (error?: Error | null) => void): void => {
  try {
    removeSourceMaps(join(buildPath, 'resources'));
    callback();
  } catch (error) {
    callback(error instanceof Error ? error : new Error('Unable to remove packaged source maps.'));
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    name: 'lotagate-desktop',
    executableName: 'lotagate-desktop',
    win32metadata: {
      CompanyName: 'LotaGate',
      FileDescription: 'LotaGate Desktop',
      InternalName: 'lotagate-desktop',
      OriginalFilename: 'lotagate-desktop.exe',
      ProductName: 'LotaGate Desktop',
    },
    asar: true,
    extraResource: [
      runtimeConfigArtifact,
      'resources/icons/lotagate.ico',
      'node_modules/@lotagate/cli/bin/lotagate.exe',
      'node_modules/node-pty',
    ],
    afterCopyExtraResources: [removePackagedSourceMaps],
    icon: 'resources/icons/lotagate',
  },
  rebuildConfig: {},
  makers: [
    new MakerWix({
      name: 'LotaGate Desktop',
      manufacturer: 'LotaGate',
      icon: resolve(process.cwd(), 'resources', 'icons', 'lotagate.ico'),
      appUserModelId: 'com.lotagate.desktop',
      programFilesFolderName: 'LotaGate Desktop',
      shortcutFolderName: 'LotaGate',
      shortcutName: 'LotaGate Desktop',
      defaultInstallMode: 'perMachine',
      upgradeCode: 'b8a4a6f4-7d5c-4f31-9c08-4c4a6f5f7f24',
      ui: { chooseDirectory: true, template: wixUiTemplate },
      lightSwitches: [`-dWixUILicenseRtf=${eulaPath}`],
    }),
    new MakerDMG({}, ['darwin']),
    ...(macInstallerIdentity
      ? [new MakerPKG({ identity: macInstallerIdentity, install: '/Applications' }, ['darwin'])]
      : []),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDeb({}),
    new MakerRpm({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'electron.vite.config.ts' },
        { entry: 'src/preload/bridge.ts', config: 'electron.vite.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;

function removeSourceMaps(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      removeSourceMaps(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      rmSync(entryPath, { force: true });
    }
  }
}

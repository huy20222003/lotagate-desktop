import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'lotagate-desktop',
    executableName: 'lotagate-desktop',
    asar: true,
    extraResource: ['.env', 'node_modules/@lotagate/cli/bin/lotagate.exe', 'node_modules/node-pty'],
    icon: 'resources/icons/lotagate',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'lotagate_desktop', authors: 'LotaGate' }),
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

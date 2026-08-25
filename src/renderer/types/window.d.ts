import type { DesktopBridge } from '../../contracts/ipc/v1/bridge.js';

declare global {
  interface Window {
    lotagate: DesktopBridge;
  }
}

export {};

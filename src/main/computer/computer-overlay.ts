import { BrowserWindow, screen } from 'electron';

const OVERLAY_WIDTH = 300;
const OVERLAY_HEIGHT = 38;
const OVERLAY_MARGIN = 18;

/** Small, click-through status indicator for native Computer Use activity. */
export class ComputerOverlay {
  private window: BrowserWindow | undefined;
  private activeCount = 0;

  show(): void {
    if (process.platform !== 'win32') return;
    this.activeCount += 1;
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;
    if (this.window === undefined || this.window.isDestroyed()) {
      this.window = new BrowserWindow({
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT,
        x: x + width - OVERLAY_WIDTH - OVERLAY_MARGIN,
        y: y + height - OVERLAY_HEIGHT - OVERLAY_MARGIN,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      this.window.setIgnoreMouseEvents(true);
      this.window.setAlwaysOnTop(true, 'floating');
      void this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`);
    }
    this.window.setPosition(x + width - OVERLAY_WIDTH - OVERLAY_MARGIN, y + height - OVERLAY_HEIGHT - OVERLAY_MARGIN, false);
    this.window.showInactive();
  }

  hide(): void {
    if (this.activeCount > 0) this.activeCount -= 1;
    if (this.activeCount > 0) return;
    if (this.window !== undefined && !this.window.isDestroyed()) this.window.hide();
  }

  destroy(): void {
    this.activeCount = 0;
    if (this.window !== undefined && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }
}

function overlayHtml(): string {
  return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;font-family:Segoe UI,Arial,sans-serif}body{display:flex;align-items:center;justify-content:center;height:100vh}.pill{box-sizing:border-box;width:292px;height:32px;padding:0 14px;border:1px solid rgba(157,211,255,.95);border-radius:16px;background:rgba(27,124,210,.94);box-shadow:0 3px 14px rgba(0,0,0,.28);color:#fff;font-size:12px;font-weight:600;letter-spacing:.1px;white-space:nowrap;text-align:center;line-height:30px}</style><div class="pill">LotaGate is using your computer</div>';
}

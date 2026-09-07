import { session, type WebContents } from 'electron';
import { LOCAL_RENDERER_ORIGIN } from './windows-constants.js';

function isOwnedRenderer(webContents: WebContents, requestingOrigin: string): boolean {
  const currentUrl = webContents.getURL();
  return currentUrl.startsWith('file://') || LOCAL_RENDERER_ORIGIN.test(currentUrl) || requestingOrigin.startsWith('file://') || LOCAL_RENDERER_ORIGIN.test(requestingOrigin);
}

export function configureMediaPermissions(): void {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => permission === 'media' && webContents !== null && isOwnedRenderer(webContents, requestingOrigin));
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const securityOrigin = 'securityOrigin' in details && typeof details.securityOrigin === 'string' ? details.securityOrigin : webContents.getURL();
    callback(permission === 'media' && isOwnedRenderer(webContents, securityOrigin));
  });
}

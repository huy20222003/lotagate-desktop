import { Notification } from 'electron';
import { formatTextClamp } from '../../shared/text.js';
import { MAX_NOTIFICATION_BODY_CHARACTERS } from './notification-constants.js';

export interface DesktopNotificationInput {
  title: string;
  body: string;
}

/** Delivers branded desktop notifications through the host OS notification surface. */
export class DesktopNotificationService {
  notify(input: DesktopNotificationInput): void {
    if (!Notification.isSupported()) return;
    new Notification({ title: input.title, body: formatTextClamp(MAX_NOTIFICATION_BODY_CHARACTERS, input.body) }).show();
  }
}

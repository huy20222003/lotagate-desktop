// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { UserMessage } from './UserMessage.js';

const activity: Activity = {
  id: 'activity-1', taskId: 'task-1', kind: 'user', text: 'What is in this image?', metadata: {}, createdAt: '2026-09-02T00:00:00.000Z',
};

describe('UserMessage', () => {
  afterEach(() => cleanup());

  it('keeps sent attachments close to the message bubble', () => {
    const { container } = render(<UserMessage activity={activity} workspaceCwd="C:\\workspace" attachments={[{ id: 'image-1', name: 'gift.png', kind: 'image', size: 1, dataUrl: 'data:image/png;base64,preview' }]} />);

    const content = container.querySelector('.user-message-content');
    const attachmentList = content?.querySelector('.attachment-preview-inline');
    const bubble = content?.querySelector('.user-message-bubble');
    if (!content || !attachmentList || !bubble) throw new Error('User attachment layout was not rendered.');
    expect(content).toBeInTheDocument();
    expect(attachmentList).toBeInTheDocument();
    expect(content.querySelector('.attachment-preview-scrollbar')).not.toBeInTheDocument();
    expect(bubble).toBeInTheDocument();
    expect(Boolean(attachmentList.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});

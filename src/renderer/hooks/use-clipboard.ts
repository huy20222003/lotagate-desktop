import { useCallback, useEffect, useRef, useState } from 'react';

const COPY_FEEDBACK_DURATION_MS = 1_500;

export type ClipboardStatus = 'idle' | 'copying' | 'copied' | 'error';

async function writeClipboardText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the Chromium-compatible fallback below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable.');
}

export function useClipboard() {
  const [status, setStatus] = useState<ClipboardStatus>('idle');
  const resetTimer = useRef<number | undefined>();

  useEffect(() => () => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    setStatus('copying');
    try {
      await writeClipboardText(text);
      setStatus('copied');
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setStatus('idle'), COPY_FEEDBACK_DURATION_MS);
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, []);

  return { copy, status };
}

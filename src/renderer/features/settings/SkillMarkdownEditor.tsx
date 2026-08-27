import { useLayoutEffect, useRef } from 'react';
import { Field, TextArea } from '../../components/ui.js';

export function SkillMarkdownEditor({ content, error, onChange }: { content: string; error?: string | undefined; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const textarea = textareaRef.current; if (!textarea) return; textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; }, [content]);
  return <Field label="Skill content (Markdown)" {...(error === undefined ? {} : { error })}><TextArea ref={textareaRef} rows={1} className="extension-detail-editor" value={content} onChange={event => onChange(event.target.value)} spellCheck={false} /></Field>;
}

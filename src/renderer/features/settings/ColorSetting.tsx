import { Button } from '../../components/ui.js';

export function ColorSetting({ label, value, custom, onChange, onReset }: { label: string; value: string; custom: boolean; onChange: (value: string) => void; onReset: () => void }) {
  return <div className="appearance-setting-row appearance-color-row"><div><strong>{label}</strong><span>{custom ? 'Custom color' : 'Theme default'}</span></div><div className="appearance-color-control"><input type="color" value={value} aria-label={label} onChange={event => onChange(event.target.value)} /><code>{value.toUpperCase()}</code>{custom ? <Button variant="ghost" onClick={onReset}>Reset</Button> : null}</div></div>;
}

import { Dropdown } from '../../components/ui.js';
import type { FontChoice } from '../../theme/theme.js';
import { fontOptions } from './appearance-options.js';

export function FontSetting({ label, value, onChange }: { label: string; value: FontChoice; onChange: (value: string) => void }) {
  return <div className="appearance-setting-row appearance-font-row"><div><strong>{label}</strong><span>Font used in the {label === 'UI font' ? 'interface' : 'code editor and previews'}.</span></div><Dropdown value={value} options={fontOptions} aria-label={label} onChange={onChange} /></div>;
}

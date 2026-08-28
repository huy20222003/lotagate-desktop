import { Check } from 'lucide-react';
import { Icon } from '../../components/ui.js';
import type { ThemeOption as ThemeOptionValue } from './appearance-options.js';

export function ThemeOption({ option, selected, onSelect }: { option: ThemeOptionValue; selected: boolean; onSelect: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} className={`theme-option ${selected ? 'selected' : ''}`} onClick={onSelect}><span className={`theme-preview theme-preview-${option.value}`} aria-hidden="true"><span /><span /><span /></span><span className="theme-option-copy"><strong><Icon icon={option.icon} size={15} /> {option.label}</strong><small>{option.detail}</small></span>{selected ? <Icon icon={Check} className="theme-option-check" size={16} /> : null}</button>;
}

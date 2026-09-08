export function ToggleSwitch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} className={`ui-toggle-switch${checked ? ' is-checked' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
}

import { useEffect, useRef } from 'react';
import { slashCommandIcon } from './slash-command-icons.js';
import { slashCommandLabel, type SlashCommandDefinition } from './slash-command.js';

export function SlashCommandPicker({ commands, selectedIndex, onSelect, onHover }: { commands: readonly SlashCommandDefinition[]; selectedIndex: number; onSelect: (command: SlashCommandDefinition) => void; onHover: (index: number) => void }) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { const option = optionRefs.current[selectedIndex]; if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  if (commands.length === 0) return <div className="slash-command-picker-empty">No available slash commands.</div>;
  return <div className="slash-command-picker" role="listbox" aria-label="Slash commands">{commands.map((command, index) => { const Icon = slashCommandIcon(command.id); return <button ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selectedIndex === index} className={`slash-command-option ${selectedIndex === index ? 'selected' : ''}`} key={command.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onSelect(command)}><Icon size={17} /><span><strong>{slashCommandLabel(command)}</strong><small>{command.description}</small></span></button>; })}</div>;
}

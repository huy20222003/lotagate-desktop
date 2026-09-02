import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { Icon } from '../../../components/ui.js';
import { slashCommandIcon } from './slash-command-icons.js';
import { slashCommandLabel, type SlashCommandDefinition } from './slash-command.js';
import { Scrollbar } from '../../../components/Scrollbar.js';

export interface SlashSkillSuggestion { name: string; description: string }

export function SlashCommandPicker({ commands, skills = [], selectedIndex, onSelect, onSelectSkill, onHover }: { commands: readonly SlashCommandDefinition[]; skills?: readonly SlashSkillSuggestion[]; selectedIndex: number; onSelect: (command: SlashCommandDefinition) => void; onSelectSkill?: (skill: SlashSkillSuggestion) => void; onHover: (index: number) => void }) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { const option = optionRefs.current[selectedIndex]; if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  const itemCount = commands.length + skills.length;
  if (itemCount === 0) return <div className="slash-command-picker-empty">No available slash commands.</div>;
  return <Scrollbar className="slash-command-picker-scrollbar"><div className="slash-command-picker" role="listbox" aria-label="Slash commands and skills">
    {commands.map((command, index) => { const CommandIcon = slashCommandIcon(command.id); return <button ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selectedIndex === index} className={`slash-command-option ${selectedIndex === index ? 'selected' : ''}`} key={`command:${command.id}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onSelect(command)}><Icon icon={CommandIcon} size={17} /><span><strong>{slashCommandLabel(command)}</strong><small>{command.description}</small></span></button>; })}
    {skills.map((skill, skillIndex) => { const index = commands.length + skillIndex; return <button ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selectedIndex === index} className={`slash-command-option ${selectedIndex === index ? 'selected' : ''}`} key={`skill:${skill.name}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onSelectSkill?.(skill)}><Icon icon={Sparkles} size={17} /><span><strong>/{skill.name}</strong><small>{skill.description || 'Run this skill with the current prompt.'}</small></span></button>; })}
  </div></Scrollbar>;
}

import skillIcon from '../../../../resources/icons/skill.svg';
import mcpIcon from '../../../../resources/icons/mcp.svg';
import hookIcon from '../../../../resources/icons/hook.svg';
import pluginIcon from '../../../../resources/icons/plugin.svg';

export type ExtensionIconKind = 'skill' | 'mcp' | 'hook' | 'plugin';

export const DEFAULT_EXTENSION_ICONS: Record<ExtensionIconKind, string> = {
  skill: skillIcon,
  mcp: mcpIcon,
  hook: hookIcon,
  plugin: pluginIcon,
};

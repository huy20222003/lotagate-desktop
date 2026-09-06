import type { ExtensionDetail, ExtensionDetailInput, PluginIcon, PublicPluginCatalogEntry, PublicPluginContributionInput } from '../../contracts/ipc/v1/extensions.js';

export interface ExtensionProtocol {
  listPublicPlugins(root: string): Promise<readonly PublicPluginCatalogEntry[]>;
  resolvePublicPluginSource(root: string, name: string): Promise<string>;
  readPublicPluginContribution(root: string, input: PublicPluginContributionInput): Promise<ExtensionDetail>;
  readDetail(cwd: string, input: Omit<ExtensionDetailInput, 'cwd'>): Promise<ExtensionDetail>;
  readPluginIcon(cwd: string, input: PluginIconInput): Promise<PluginIcon | undefined>;
}

export interface PluginIconInput {
  name: string;
  scope: 'user' | 'project';
}

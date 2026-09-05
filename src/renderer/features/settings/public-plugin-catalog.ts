import type { PluginContributionKind } from './extension-command-client.js';

export interface PublicPluginCatalogContribution {
  kind: PluginContributionKind;
  sourceName: string;
  description: string;
}

export interface PublicPluginCatalogEntry {
  directory: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  icon?: string;
  contributions: readonly PublicPluginCatalogContribution[];
}

/** Curated Desktop plugins. Add only reviewed, trusted sources here. */
export const PUBLIC_PLUGIN_CATALOG: readonly PublicPluginCatalogEntry[] = [
  {
    directory: 'workspace-review',
    name: 'workspace-review',
    version: '1.0.0',
    description: 'Review a workspace for correctness, risk, and missing verification steps.',
    author: 'LotaGate',
    license: 'MIT',
    homepage: 'https://lotagate.com/',
    privacyPolicy: 'https://lotagate.com/privacy',
    termsOfService: 'https://lotagate.com/terms',
    contributions: [
      { kind: 'skill', sourceName: 'review-workspace', description: 'Review a requested workspace change for correctness, risk, and verification coverage.' },
      { kind: 'agent', sourceName: 'reviewer', description: 'Inspect a change and identify concrete correctness or verification gaps.' },
    ],
  },
  {
    directory: 'release-notes',
    name: 'release-notes',
    version: '1.0.0',
    description: 'Turn completed work and verification evidence into concise release notes.',
    author: 'LotaGate',
    license: 'MIT',
    homepage: 'https://lotagate.com/',
    privacyPolicy: 'https://lotagate.com/privacy',
    termsOfService: 'https://lotagate.com/terms',
    contributions: [
      { kind: 'skill', sourceName: 'write-release-notes', description: 'Summarize completed work, changed files, and verified behavior as release notes.' },
    ],
  },
  {
    directory: 'project-planner',
    name: 'project-planner',
    version: '1.0.0',
    description: 'Create focused implementation plans that follow the project architecture.',
    author: 'LotaGate',
    license: 'MIT',
    homepage: 'https://lotagate.com/',
    privacyPolicy: 'https://lotagate.com/privacy',
    termsOfService: 'https://lotagate.com/terms',
    contributions: [
      { kind: 'skill', sourceName: 'plan-change', description: 'Build a small implementation plan from repository evidence and existing project patterns.' },
    ],
  },
];

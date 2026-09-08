import { describe, expect, it } from 'vitest';
import { extractWorkspaceModels } from './model-catalog.js';

describe('workspace model catalog', () => {
  it('preserves the CLI model category for command-specific selection', () => {
    expect(extractWorkspaceModels({ models: [{ id: 'model-1', label: 'Model 1', model_category: 'image', context_window: 128_000 }] })).toEqual([{ id: 'model-1', label: 'Model 1', category: 'image', contextWindow: 128_000 }]);
  });

  it('accepts the CLI model field as the option id', () => {
    expect(extractWorkspaceModels({ models: [{ model: 'model-1', context_window: '64000' }] })).toEqual([{ id: 'model-1', label: 'model-1', contextWindow: 64_000 }]);
  });

  it('uses display_name for presentation while preserving the model id', () => {
    expect(extractWorkspaceModels({ models: [{ id: 'model-1', display_name: 'Friendly model name' }] })).toEqual([{ id: 'model-1', label: 'Friendly model name' }]);
  });
});

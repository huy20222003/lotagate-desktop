// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProfileModelUsage } from './ProfileModelUsage.js';

describe('ProfileModelUsage', () => {
  it('renders the first ten models with token and request totals', () => {
    const models = Array.from({ length: 11 }, (_, index) => ({ modelCode: `model-${index + 1}`, totalTokens: (index + 1) * 1_000, totalRequests: index + 1 }));

    render(<ProfileModelUsage models={models} loading={false} />);

    expect(screen.getByRole('columnheader', { name: 'Model' })).toBeVisible();
    expect(screen.getByText('model-1')).toBeVisible();
    expect(screen.getByText('model-10')).toBeVisible();
    expect(screen.queryByText('model-11')).not.toBeInTheDocument();
    expect(screen.getByText('10.0K')).toBeVisible();
    expect(screen.getAllByText('10')).toHaveLength(2);
  });
});

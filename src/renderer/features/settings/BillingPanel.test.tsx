// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingPanel } from './BillingPanel.js';

describe('BillingPanel', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('requests each payment page from the API and uses the server total', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => payment(index + 1));
    const secondPage = [payment(11)];
    const paymentHistory = vi.fn((_: string, page: number) => Promise.resolve({ data: page === 1 ? firstPage : secondPage, total: 11 }));
    window.lotagate = { userContext: { wallet: vi.fn().mockResolvedValue({ balance: '10', bonus: '0', outstandingDebt: '0', currency: 'USD' }), paymentHistory } } as unknown as typeof window.lotagate;

    render(<BillingPanel organizationCode="acme" />);

    await waitFor(() => expect(screen.getByText('Payment 1')).toBeVisible());
    expect(paymentHistory).toHaveBeenCalledWith('acme', 1, 10);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(paymentHistory).toHaveBeenCalledWith('acme', 2, 10));
    await waitFor(() => expect(screen.getByText('Payment 11')).toBeVisible());
  });
});

function payment(id: number) { return { id: `payment-${id}`, date: '2026-08-28T00:00:00.000Z', description: `Payment ${id}`, amount: '10.00', currency: 'USD', status: 'COMPLETED' }; }

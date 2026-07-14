/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStateProvider } from '../../lib/store';
import { useToast, type NotifyInput } from '../../hooks/useToast';
import { Toaster } from './toaster';

function Emitter({ input }: { input: NotifyInput }) {
  const { notify } = useToast();
  return (
    <button type="button" onClick={() => notify(input)}>
      emit
    </button>
  );
}

function renderToaster(input: NotifyInput, durationMs?: number) {
  return render(
    <AppStateProvider>
      <Emitter input={input} />
      <Toaster durationMs={durationMs} />
    </AppStateProvider>,
  );
}

describe('Toaster', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders an Alert for a notification enqueued through the hook', () => {
    renderToaster({ message: 'Saved your changes' });
    expect(screen.queryByText('Saved your changes')).toBeNull();

    fireEvent.click(screen.getByText('emit'));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Saved your changes');
  });

  it('renders a title when one is provided', () => {
    renderToaster({ title: 'Sync failed', message: 'Retry in a moment', variant: 'destructive' });
    fireEvent.click(screen.getByText('emit'));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Sync failed');
    expect(alert.textContent).toContain('Retry in a moment');
  });

  it('removes a toast when its dismiss control is clicked', async () => {
    renderToaster({ message: 'Dismiss me' });
    fireEvent.click(screen.getByText('emit'));
    expect(screen.getByText('Dismiss me')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).toBeNull();
    });
  });

  it('auto-dismisses a toast after the configured duration', () => {
    vi.useFakeTimers();
    try {
      renderToaster({ message: 'Fades away' }, 4_000);
      fireEvent.click(screen.getByText('emit'));
      expect(screen.getByText('Fades away')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(4_000);
      });

      expect(screen.queryByText('Fades away')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

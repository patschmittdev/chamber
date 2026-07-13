import type { BrowserWindow, TitleBarOverlay } from 'electron';

/**
 * Native Windows title-bar overlay theming.
 *
 * The frameless windows use a Windows `titleBarOverlay` for the min/max/close
 * chrome. Its colors are baked in at window creation, so when the renderer theme
 * changes we must repaint the overlay to keep the OS chrome legible against the
 * new app background. Both the initial window options and the runtime repaint go
 * through this single source of truth.
 */

export type TitleBarTheme = 'light' | 'dark';

export const TITLE_BAR_OVERLAY_HEIGHT = 36;

interface TitleBarOverlayColors {
  /** Background of the overlay strip. Matches `--color-background`. */
  readonly color: string;
  /** Color of the min/max/close glyphs. Matches `--color-foreground`. */
  readonly symbolColor: string;
}

const OVERLAY_COLORS: Record<TitleBarTheme, TitleBarOverlayColors> = {
  dark: { color: '#09090b', symbolColor: '#fafafa' },
  light: { color: '#ffffff', symbolColor: '#0a0a0a' },
};

/** Background color used before the renderer paints. */
export function windowBackgroundColorFor(theme: TitleBarTheme): string {
  return OVERLAY_COLORS[theme].color;
}

/** Build the `titleBarOverlay` window option for a theme. */
export function titleBarOverlayFor(theme: TitleBarTheme): TitleBarOverlay {
  return { ...OVERLAY_COLORS[theme], height: TITLE_BAR_OVERLAY_HEIGHT };
}

/**
 * Repaint a window's native title-bar overlay to match the given theme. A no-op
 * on platforms without an overlay (only Windows renders one) and when the target
 * window is missing.
 *
 * The repaint is best-effort: Electron throws `TypeError: Titlebar overlay is not
 * enabled` when a window was created without an enabled overlay (for example a
 * non-`hidden` title-bar style, or a secondary window). Title-bar chrome is
 * cosmetic, so a failed repaint is swallowed and must never block an appearance
 * change from broadcasting to the renderer.
 */
export function applyTitleBarTheme(
  win: Pick<BrowserWindow, 'setTitleBarOverlay'> | null | undefined,
  theme: TitleBarTheme,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!win || platform !== 'win32') return;
  try {
    win.setTitleBarOverlay(titleBarOverlayFor(theme));
  } catch {
    // Overlay not enabled for this window; leave the OS chrome as-is.
  }
}

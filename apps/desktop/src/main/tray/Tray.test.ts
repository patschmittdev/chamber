import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';

const {
  getFileIcon,
  createFromDataURL,
  buildFromTemplate,
  trayCtor,
} = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
  createFromDataURL: vi.fn(),
  buildFromTemplate: vi.fn(),
  trayCtor: vi.fn(function TrayMock(this: {
    setToolTip: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }) {
    this.setToolTip = vi.fn();
    this.setContextMenu = vi.fn();
    this.on = vi.fn();
  }),
}));

vi.mock('electron', () => ({
  app: { getFileIcon },
  nativeImage: { createFromDataURL },
  Menu: { buildFromTemplate },
  Tray: trayCtor,
}));

import { createAppTray, loadAppIcon } from './Tray';

function makeIcon(empty = false): NativeImage {
  const icon = {
    isEmpty: vi.fn(() => empty),
    resize: vi.fn(() => icon),
  };

  return icon as unknown as NativeImage;
}

function withPlatform(platform: NodeJS.Platform, run: () => Promise<void> | void) {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return Promise.resolve(run()).finally(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });
}

describe('loadAppIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the executable icon when Electron provides one', () =>
    withPlatform('win32', async () => {
      const executableIcon = makeIcon(false);
      getFileIcon.mockResolvedValue(executableIcon);

      const icon = await loadAppIcon();

      expect(getFileIcon).toHaveBeenCalledWith(process.execPath, { size: 'large' });
      expect(createFromDataURL).not.toHaveBeenCalled();
      expect(icon).toBe(executableIcon);
    }));

  it('falls back to the generated icon when the executable icon is empty', () =>
    withPlatform('win32', async () => {
      const fallbackIcon = makeIcon(false);
      getFileIcon.mockResolvedValue(makeIcon(true));
      createFromDataURL.mockReturnValue(fallbackIcon);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const icon = await loadAppIcon();

      expect(createFromDataURL).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledOnce();
      expect(icon).toBe(fallbackIcon);
      warn.mockRestore();
    }));

  it('falls back to the generated icon when executable icon lookup fails', () =>
    withPlatform('win32', async () => {
      const fallbackIcon = makeIcon(false);
      const error = new Error('boom');
      getFileIcon.mockRejectedValue(error);
      createFromDataURL.mockReturnValue(fallbackIcon);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const icon = await loadAppIcon();

      expect(createFromDataURL).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('[tray]', 'Failed to load executable icon:', error);
      expect(icon).toBe(fallbackIcon);
      consoleError.mockRestore();
    }));

  it('skips getFileIcon on darwin and returns the fallback', () =>
    withPlatform('darwin', async () => {
      const fallbackIcon = makeIcon(false);
      createFromDataURL.mockReturnValue(fallbackIcon);

      const icon = await loadAppIcon();

      expect(getFileIcon).not.toHaveBeenCalled();
      expect(createFromDataURL).toHaveBeenCalledTimes(1);
      expect(icon).toBe(fallbackIcon);
    }));
});

describe('createAppTray', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildFromTemplate.mockReturnValue('menu');
  });

  it('builds a tray menu with status and actionable controls when chatroom is running', () => {
    const showMainWindow = vi.fn();
    const stopChatroomRun = vi.fn();
    const quit = vi.fn();
    const tray = createAppTray(
      {
        showMainWindow,
        stopChatroomRun,
        isChatroomRunning: () => true,
        getReadyMindCount: () => 3,
        quit,
      },
      makeIcon(false),
    );

    const template = buildFromTemplate.mock.calls[0][0] as Array<{ label?: string; enabled?: boolean }>;
    expect(template[0]).toMatchObject({ label: 'Agents: 3 ready | Chatroom: running', enabled: false });
    expect(template[3]).toMatchObject({ label: 'Stop chatroom run', enabled: true });

    const trayInstance = trayCtor.mock.results[0]?.value as {
      setToolTip: ReturnType<typeof vi.fn>;
      setContextMenu: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    expect(trayInstance.setToolTip).toHaveBeenCalledWith('Chamber (Agents: 3 ready | Chatroom: running)');
    expect(trayInstance.setContextMenu).toHaveBeenCalledWith('menu');
    expect(trayInstance.on).toHaveBeenCalledWith('click', showMainWindow);
    expect(tray).toBe(trayInstance);
  });

  it('disables stop action when no chatroom run is active', () => {
    createAppTray(
      {
        showMainWindow: vi.fn(),
        stopChatroomRun: vi.fn(),
        isChatroomRunning: () => false,
        getReadyMindCount: () => 1,
        quit: vi.fn(),
      },
      makeIcon(false),
    );

    const template = buildFromTemplate.mock.calls[0][0] as Array<{ label?: string; enabled?: boolean }>;
    expect(template[3]).toMatchObject({ label: 'No chatroom run in progress', enabled: false });
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasService } from './CanvasService';
import type { CanvasServerLike } from './types';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'chamber-canvas-service-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeMindPath(): string {
  return makeTempDir();
}

function tryCreateSymlink(target: string, linkPath: string): boolean {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

class MockCanvasServer implements CanvasServerLike {
  private port: number | null = null;

  readonly start = vi.fn(async () => {
    if (this.port === null) {
      this.port = 4312;
    }
    return this.port;
  });

  readonly stop = vi.fn(async () => {
    this.port = null;
  });

  readonly reload = vi.fn();
  readonly closeClients = vi.fn();

  readonly getPort = vi.fn(() => this.port);
  readonly isRunning = vi.fn(() => this.port !== null);
  readonly registerGrant = vi.fn();
}

describe('CanvasService', () => {
  let server: MockCanvasServer;
  let openedUrls: string[];
  let service: CanvasService;
  let storageRoot: string;

  beforeEach(() => {
    server = new MockCanvasServer();
    openedUrls = [];
    storageRoot = makeTempDir('chamber-canvas-storage-');
    service = new CanvasService({
      storageRoot,
      openExternal: { open: (url) => { openedUrls.push(url); } },
      server,
    });
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('activateMind creates the per-mind canvas directory under storageRoot', async () => {
    const mindPath = makeMindPath();

    await service.activateMind('mind-1', mindPath);

    expect(fs.existsSync(path.join(storageRoot, 'mind-1'))).toBe(true);
  });

  it('shows a wrapped canvas, starts the server, and opens the browser by default', async () => {
    const mindPath = makeMindPath();

    const result = await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Plan</h1>',
      name: 'daily-plan',
    });

    const contentPath = path.join(storageRoot, 'mind-1', 'daily-plan.html');
    const content = fs.readFileSync(contentPath, 'utf8');

    expect(server.start).toHaveBeenCalledOnce();
    expect(openedUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:4312\/mind-1\/daily-plan\.html\?token=[A-Za-z0-9_-]+$/);
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('<h1>Plan</h1>');
    expect(result).toContain('opened in browser');
    expect(service.listCanvases('mind-1', mindPath)).toContain('daily-plan');
  });

  it('can copy an existing html file without opening the browser', async () => {
    const mindPath = makeMindPath();
    const sourceFile = path.join(mindPath, 'source.html');
    fs.writeFileSync(sourceFile, '<html><body>From file</body></html>', 'utf8');

    const result = await service.showCanvas('mind-1', mindPath, {
      file: sourceFile,
      name: 'copied',
      open_browser: false,
    });

    const copied = fs.readFileSync(path.join(storageRoot, 'mind-1', 'copied.html'), 'utf8');
    expect(copied).toBe('<html><body>From file</body></html>');
    expect(openedUrls).toHaveLength(0);
    expect(result).toMatch(/http:\/\/127\.0\.0\.1:4312\/mind-1\/copied\.html\?token=[A-Za-z0-9_-]+/);
  });

  it('serves a Lens html source as an embedded canvas without opening the browser', async () => {
    const mindPath = makeMindPath();
    const sourceFile = path.join(mindPath, '.github', 'lens', 'command-center', 'index.html');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, '<html><body>Command</body></html>', 'utf8');

    const url = await service.showLensCanvas('mind-1', mindPath, 'command-center', sourceFile);

    expect(server.start).toHaveBeenCalledOnce();
    expect(openedUrls).toHaveLength(0);
    const servedFilename = new URL(url).pathname.split('/').pop();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4312\/mind-1\/lens-[a-f0-9]{16}\.html\?token=[A-Za-z0-9_-]+$/);
    expect(fs.readFileSync(path.join(storageRoot, 'mind-1', servedFilename ?? ''), 'utf8')).toContain('Command');
    expect(server.reload).toHaveBeenCalledWith('mind-1', servedFilename);
  });

  it('rejects embedded Lens canvas sources outside the mind lens directory', async () => {
    const mindPath = makeMindPath();
    const sourceFile = path.join(mindPath, 'outside.html');
    fs.writeFileSync(sourceFile, '<html><body>Outside</body></html>', 'utf8');

    await expect(service.showLensCanvas('mind-1', mindPath, 'outside', sourceFile))
      .rejects.toThrow('inside the mind .github/lens directory');
  });

  it('updates an existing canvas and triggers targeted reload', async () => {
    const mindPath = makeMindPath();
    await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Before</h1>',
      name: 'report',
      open_browser: false,
    });

    const result = service.updateCanvas('mind-1', mindPath, {
      html: '<h1>After</h1>',
      name: 'report',
    });

    const content = fs.readFileSync(path.join(storageRoot, 'mind-1', 'report.html'), 'utf8');
    expect(content).toContain('<h1>After</h1>');
    expect(server.reload).toHaveBeenCalledWith('mind-1', 'report.html');
    expect(result).toContain('updated');
  });

  it('closes a single canvas, removes its file, and stops the server when it was the last one', async () => {
    const mindPath = makeMindPath();
    await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Report</h1>',
      name: 'report',
      open_browser: false,
    });

    const result = await service.closeCanvas('mind-1', mindPath, {
      name: 'report',
    });

    expect(server.closeClients).toHaveBeenCalledWith('mind-1', 'report.html');
    expect(server.stop).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(storageRoot, 'mind-1', 'report.html'))).toBe(false);
    expect(result).toContain('Server stopped');
  });

  it('close all only affects the current mind and keeps the server running if others remain', async () => {
    const mindPathA = makeMindPath();
    const mindPathB = makeMindPath();

    await service.showCanvas('mind-a', mindPathA, {
      html: '<h1>A</h1>',
      name: 'alpha',
      open_browser: false,
    });
    await service.showCanvas('mind-b', mindPathB, {
      html: '<h1>B</h1>',
      name: 'beta',
      open_browser: false,
    });

    const result = await service.closeCanvas('mind-a', mindPathA, {
      name: 'all',
    });

    expect(server.closeClients).toHaveBeenCalledWith('mind-a');
    expect(server.stop).not.toHaveBeenCalled();
    expect(result).toContain('1 canvas(es) still active');
    expect(service.listCanvases('mind-b', mindPathB)).toContain('beta');
  });

  it('releaseMind closes that mind clients and stops the server when no canvases remain', async () => {
    const mindPath = makeMindPath();
    await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Report</h1>',
      name: 'report',
      open_browser: false,
    });

    await service.releaseMind('mind-1');

    expect(server.closeClients).toHaveBeenCalledWith('mind-1');
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it('rejects invalid names and missing content', async () => {
    const mindPath = makeMindPath();

    await expect(service.showCanvas('mind-1', mindPath, {
      html: '<h1>Bad</h1>',
      name: '../bad',
    })).rejects.toThrow('Invalid canvas name');

    await expect(service.showCanvas('mind-1', mindPath, {
      name: 'empty',
    })).rejects.toThrow('canvas_show requires either "html" or "file"');
  });

  describe('symlink and escape rejection', () => {
    it('rejects a canvas source file that is a symlink', async () => {
      const mindPath = makeMindPath();
      const realFile = path.join(mindPath, 'real.html');
      fs.writeFileSync(realFile, '<html>Real</html>', 'utf8');
      const linkPath = path.join(mindPath, 'linked.html');
      const canCreate = tryCreateSymlink(realFile, linkPath);
      if (!canCreate) return; // Skip on platforms requiring elevation.

      await expect(service.showCanvas('mind-1', mindPath, {
        file: linkPath,
        name: 'from-link',
        open_browser: false,
      })).rejects.toThrow('symlink');
    });

    it('rejects a Lens canvas source that is a symlink inside the lens directory', async () => {
      const mindPath = makeMindPath();
      const lensDir = path.join(mindPath, '.github', 'lens', 'view-a');
      fs.mkdirSync(lensDir, { recursive: true });
      const realHtml = path.join(mindPath, 'real.html');
      fs.writeFileSync(realHtml, '<html>Real</html>', 'utf8');
      const linkPath = path.join(lensDir, 'index.html');
      const canCreate = tryCreateSymlink(realHtml, linkPath);
      if (!canCreate) return;

      await expect(service.showLensCanvas('mind-1', mindPath, 'view-a', linkPath))
        .rejects.toThrow('must be inside');
    });

    it('rejects a Lens canvas source where an ancestor directory is a symlink', async () => {
      const mindPath = makeMindPath();
      const realDir = makeTempDir('chamber-canvas-real-');
      fs.writeFileSync(path.join(realDir, 'index.html'), '<html>Escaped</html>', 'utf8');
      const lensBase = path.join(mindPath, '.github', 'lens');
      fs.mkdirSync(lensBase, { recursive: true });
      const linkedViewDir = path.join(lensBase, 'escaped-view');
      const canCreate = tryCreateSymlink(realDir, linkedViewDir);
      if (!canCreate) return;

      const sourcePath = path.join(linkedViewDir, 'index.html');
      await expect(service.showLensCanvas('mind-1', mindPath, 'escaped-view', sourcePath))
        .rejects.toThrow();
    });
  });

  describe('generated canvas storage stays under storageRoot', () => {
    it('canvas html files are written under storageRoot/<mindId>/ not mindPath', async () => {
      const mindPath = makeMindPath();
      await service.showCanvas('mind-1', mindPath, {
        html: '<h1>Private</h1>',
        name: 'private-canvas',
        open_browser: false,
      });

      // File must exist under storageRoot, not under mindPath.
      expect(fs.existsSync(path.join(storageRoot, 'mind-1', 'private-canvas.html'))).toBe(true);
      expect(fs.existsSync(path.join(mindPath, '.chamber', 'canvas', 'private-canvas.html'))).toBe(false);
    });

    it('deleted canvas files are removed from storageRoot only', async () => {
      const mindPath = makeMindPath();
      await service.showCanvas('mind-1', mindPath, { html: '<p>X</p>', name: 'x', open_browser: false });
      await service.closeCanvas('mind-1', mindPath, { name: 'x' });

      expect(fs.existsSync(path.join(storageRoot, 'mind-1', 'x.html'))).toBe(false);
    });
  });
});

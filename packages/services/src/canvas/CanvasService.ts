import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '../logger';
import type { ChamberToolProvider } from '../chamberTools';
import type { CanvasGestureGrant } from '@chamber/shared/canvas-action-types';
import { assertContained, ContainmentError, writeAtomically } from '../fsContainment';

const log = Logger.create('canvas');
import type { Tool } from '../mind/types';
import type { ExternalOpener } from '../ports';
import { CanvasServer } from './CanvasServer';
import { buildCanvasTools } from './tools';
import type {
  CanvasAction,
  CanvasActionHandler,
  CanvasActionStatusEvent,
  CanvasCloseInput,
  CanvasEntry,
  CanvasServerLike,
  CanvasShowInput,
  CanvasUpdateInput,
} from './types';

const VALID_CANVAS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface CanvasServiceOptions {
  /**
   * App-owned directory under which per-mind canvas storage is created.
   * Defaults to a `.canvas` subdirectory of the current working directory
   * when not supplied. Production usage must inject `userData/canvas`.
   */
  storageRoot?: string;
  onAction?: CanvasActionHandler;
  onActionStatus?: (status: CanvasActionStatusEvent) => void;
  openExternal?: ExternalOpener;
  server?: CanvasServerLike;
}

function validateCanvasName(name: string): void {
  if (name === 'all') {
    throw new Error('"all" is reserved for canvas_close and cannot be used as a canvas name');
  }

  if (!VALID_CANVAS_NAME.test(name)) {
    throw new Error(`Invalid canvas name "${name}". Use letters, numbers, dots, underscores, or hyphens.`);
  }
}

function wrapHtml(name: string, html: string, title?: string): string {
  const lowerCaseHtml = html.toLowerCase();
  if (!lowerCaseHtml.includes('<!doctype') && !lowerCaseHtml.includes('<html')) {
    const pageTitle = title ?? name;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
</head>
<body>
${html}
</body>
</html>`;
  }

  if (title && !lowerCaseHtml.includes('<title>')) {
    return html.replace('</head>', `  <title>${title}</title>\n</head>`);
  }

  return html;
}

export class CanvasService implements ChamberToolProvider {
  private readonly mindPaths = new Map<string, string>();
  private readonly canvases = new Map<string, Map<string, CanvasEntry>>();
  private readonly lensViewIdsByCanvas = new Map<string, Map<string, string>>();
  private readonly server: CanvasServerLike;
  private readonly openExternal: ExternalOpener;
  private readonly onAction: CanvasActionHandler;
  private readonly actionStatusListeners = new Set<(status: CanvasActionStatusEvent) => void>();
  private readonly storageRoot: string;

  constructor(options: CanvasServiceOptions = {}) {
    this.storageRoot = options.storageRoot ?? path.join(process.cwd(), '.canvas');

    this.onAction = options.onAction ?? ((action: CanvasAction) => {
      log.info('Action received:', action);
    });

    this.server = options.server ?? new CanvasServer({
      resolveContentDir: (mindId) => this.getContentDirForMind(mindId),
      onAction: (action) => this.onAction(this.decorateCanvasAction(action)),
      onActionStatus: (status) => this.publishActionStatus(this.decorateCanvasActionStatus(status)),
      authorizeRequest: (mindId, filename, token) => this.isAuthorizedCanvasRequest(mindId, filename, token),
    });
    if (options.onActionStatus) this.actionStatusListeners.add(options.onActionStatus);
    this.openExternal = options.openExternal ?? {
      open: () => {
        throw new Error('CanvasService requires an ExternalOpener adapter');
      },
    };
  }

  getToolsForMind(mindId: string, mindPath: string): Tool[] {
    return buildCanvasTools(mindId, mindPath, this) as Tool[];
  }

  async activateMind(mindId: string, mindPath: string): Promise<void> {
    this.ensureMind(mindId, mindPath);
  }

  async releaseMind(mindId: string): Promise<void> {
    this.server.closeClients(mindId);
    this.canvases.delete(mindId);
    this.lensViewIdsByCanvas.delete(mindId);
    this.mindPaths.delete(mindId);
    await this.stopServerIfIdle();
  }

  async showCanvas(mindId: string, mindPath: string, input: CanvasShowInput): Promise<string> {
    validateCanvasName(input.name);
    if (!input.html && !input.file) {
      throw new Error('canvas_show requires either "html" or "file"');
    }

    const contentDir = this.ensureMind(mindId, mindPath);
    const filename = `${input.name}.html`;

    // Validate destination is inside the private storage root before writing.
    let targetPath: string;
    try {
      targetPath = assertContained(contentDir, filename);
    } catch (err) {
      throw new Error(`Canvas destination path rejected: ${err instanceof ContainmentError ? err.message : String(err)}`, { cause: err });
    }

    if (input.file) {
      if (!path.isAbsolute(input.file)) {
        throw new Error('canvas_show file must be an absolute path');
      }
      if (!fs.existsSync(input.file)) {
        throw new Error(`Canvas source file not found: ${input.file}`);
      }
      // Reject symlinks in the source file — prevents agents from staging
      // hostile content through a symlink to an attacker-controlled path.
      try {
        if (fs.lstatSync(input.file).isSymbolicLink()) {
          throw new Error(`Canvas source file is a symlink and cannot be trusted: ${input.file}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('symlink')) throw err;
        throw new Error(`Canvas source file is inaccessible: ${input.file}`, { cause: err });
      }
      const content = fs.readFileSync(input.file);
      writeAtomically(targetPath, content);
    } else {
      writeAtomically(targetPath, wrapHtml(input.name, input.html ?? '', input.title));
    }

    const port = await this.server.start();
    const token = this.getExistingToken(mindId, input.name) ?? createCanvasToken();
    const url = this.buildCanvasUrl(mindId, filename, port, token);
    this.upsertCanvas(mindId, {
      filename,
      name: input.name,
      url,
      token,
    });

    if (input.open_browser !== false) {
      await this.openExternal.open(url);
      return `Canvas **${input.name}** is live at ${url} (opened in browser)`;
    }

    return `Canvas **${input.name}** is live at ${url}`;
  }

  async showLensCanvas(mindId: string, mindPath: string, viewId: string, sourcePath: string): Promise<string> {
    if (!path.isAbsolute(sourcePath)) {
      throw new Error('Canvas Lens source path must be absolute');
    }
    const lensDir = path.join(mindPath, '.github', 'lens');

    // Use realpath-based containment to reject symlink escapes in the source tree.
    try {
      assertContained(lensDir, sourcePath);
    } catch {
      throw new Error('Canvas Lens source path must be inside the mind .github/lens directory');
    }

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Canvas Lens source file not found: ${sourcePath}`);
    }

    // Reject symlinks in the source file — the source tree is agent-managed and
    // could have symlinks pointing to sensitive files outside the lens directory.
    try {
      if (fs.lstatSync(sourcePath).isSymbolicLink()) {
        throw new Error(`Canvas Lens source file is a symlink: ${sourcePath}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('symlink')) throw err;
    }

    const contentDir = this.ensureMind(mindId, mindPath);
    const name = this.getLensCanvasName(viewId);
    const filename = `${name}.html`;

    // Validate destination is inside the private storage root.
    let destPath: string;
    try {
      destPath = assertContained(contentDir, filename);
    } catch (err) {
      throw new Error(`Canvas destination path rejected: ${err instanceof ContainmentError ? err.message : String(err)}`, { cause: err });
    }

    const content = fs.readFileSync(sourcePath);
    writeAtomically(destPath, content);

    const port = await this.server.start();
    const token = this.getExistingToken(mindId, name) ?? createCanvasToken();
    const url = this.buildCanvasUrl(mindId, filename, port, token);
    this.upsertCanvas(mindId, {
      filename,
      name,
      url,
      token,
    });

    const lensViews = this.lensViewIdsByCanvas.get(mindId) ?? new Map<string, string>();
    lensViews.set(filename, viewId);
    this.lensViewIdsByCanvas.set(mindId, lensViews);
    this.server.reload(mindId, filename);

    return url;
  }

  updateCanvas(mindId: string, mindPath: string, input: CanvasUpdateInput): string {
    validateCanvasName(input.name);
    const contentDir = this.ensureMind(mindId, mindPath);
    const existing = this.requireCanvas(mindId, input.name);

    // Revalidate destination before write — closes check-to-use race.
    let destPath: string;
    try {
      destPath = assertContained(contentDir, existing.filename);
    } catch (err) {
      throw new Error(`Canvas destination path rejected: ${err instanceof ContainmentError ? err.message : String(err)}`, { cause: err });
    }

    writeAtomically(destPath, wrapHtml(input.name, input.html, input.title));
    this.server.reload(mindId, existing.filename);
    return `Canvas **${input.name}** updated. Browser will auto-reload.`;
  }

  async closeCanvas(mindId: string, mindPath: string, input: CanvasCloseInput): Promise<string> {
    this.ensureMind(mindId, mindPath);
    if (input.name === 'all') {
      return this.closeAllCanvases(mindId);
    }

    validateCanvasName(input.name);
    const existing = this.requireCanvas(mindId, input.name);
    this.server.closeClients(mindId, existing.filename);

    const canvases = this.canvases.get(mindId);
    canvases?.delete(input.name);
    this.removeLensCanvasMapping(mindId, existing.filename);
    if (canvases && canvases.size === 0) {
      this.canvases.delete(mindId);
    }

    this.deleteCanvasFile(mindId, existing.filename);
    const remaining = this.totalCanvasCount();
    if (remaining === 0) {
      await this.server.stop();
      return `Canvas **${input.name}** closed. Server stopped (no remaining canvases).`;
    }

    return `Canvas **${input.name}** closed. ${remaining} canvas(es) still active.`;
  }

  listCanvases(mindId: string, mindPath: string): string {
    this.ensureMind(mindId, mindPath);
    const canvases = this.canvases.get(mindId);
    if (!canvases || canvases.size === 0) {
      return 'No canvases are open.';
    }

    const lines = [...canvases.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => `- **${entry.name}** - ${entry.url}`);

    const status = this.server.isRunning()
      ? `Server running on port ${this.server.getPort()}`
      : 'Server not running';

    return `${lines.join('\n')}\n\n${status}`;
  }

  subscribeToActionStatus(listener: (status: CanvasActionStatusEvent) => void): () => void {
    this.actionStatusListeners.add(listener);
    return () => this.actionStatusListeners.delete(listener);
  }

  /**
   * Register a renderer gesture grant with the underlying CanvasServer so it
   * can be validated when the Canvas bridge dispatches the corresponding action.
   */
  registerGrant(grant: CanvasGestureGrant): void {
    this.server.registerGrant(grant);
  }

  private async closeAllCanvases(mindId: string): Promise<string> {
    const canvases = this.canvases.get(mindId);
    if (!canvases || canvases.size === 0) {
      return 'No canvases are open.';
    }

    this.server.closeClients(mindId);
    const count = canvases.size;
    for (const entry of canvases.values()) {
      this.deleteCanvasFile(mindId, entry.filename);
      this.removeLensCanvasMapping(mindId, entry.filename);
    }
    this.canvases.delete(mindId);

    const remaining = this.totalCanvasCount();
    if (remaining === 0) {
      await this.server.stop();
      return `Closed ${count} canvas(es) and stopped the server.`;
    }

    return `Closed ${count} canvas(es). ${remaining} canvas(es) still active.`;
  }

  private ensureMind(mindId: string, mindPath: string): string {
    this.mindPaths.set(mindId, mindPath);
    // Canvas files are stored under the app-owned private storage root, not
    // inside the mind's workspace directory. This prevents an agent from
    // creating symlinks inside its workspace to interfere with canvas storage.
    const contentDir = path.join(this.storageRoot, mindId);
    fs.mkdirSync(contentDir, { recursive: true });
    return contentDir;
  }

  private requireCanvas(mindId: string, name: string): CanvasEntry {
    const existing = this.canvases.get(mindId)?.get(name);
    if (!existing) {
      throw new Error(`Canvas "${name}" not found. Use canvas_show to create it first.`);
    }
    return existing;
  }

  private getContentDirForMind(mindId: string): string | null {
    if (!this.mindPaths.has(mindId)) return null;
    return path.join(this.storageRoot, mindId);
  }

  private upsertCanvas(mindId: string, entry: CanvasEntry): void {
    const canvases = this.canvases.get(mindId) ?? new Map<string, CanvasEntry>();
    canvases.set(entry.name, entry);
    this.canvases.set(mindId, canvases);
  }

  private buildCanvasUrl(mindId: string, filename: string, port: number, token: string): string {
    return `http://127.0.0.1:${port}/${encodeURIComponent(mindId)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
  }

  private getLensCanvasName(viewId: string): string {
    const digest = createHash('sha256').update(viewId).digest('hex').slice(0, 16);
    return `lens-${digest}`;
  }

  private decorateCanvasAction(action: CanvasAction): CanvasAction {
    const lensViewId = this.lensViewIdsByCanvas.get(action.mindId)?.get(action.canvas);
    return lensViewId ? { ...action, lensViewId } : action;
  }

  private decorateCanvasActionStatus(status: CanvasActionStatusEvent): CanvasActionStatusEvent {
    const lensViewId = this.lensViewIdsByCanvas.get(status.mindId)?.get(status.canvas);
    return lensViewId ? { ...status, lensViewId } : status;
  }

  private publishActionStatus(status: CanvasActionStatusEvent): void {
    for (const listener of this.actionStatusListeners) {
      try {
        listener(status);
      } catch (error) {
        log.warn('Failed to publish Canvas action status:', error);
      }
    }
  }

  private getExistingToken(mindId: string, name: string): string | null {
    return this.canvases.get(mindId)?.get(name)?.token ?? null;
  }

  private isAuthorizedCanvasRequest(mindId: string, filename: string, token: string | null): boolean {
    if (!token) return false;
    const canvases = this.canvases.get(mindId);
    if (!canvases) return false;
    const normalizedFilename = filename.replace(/\\/g, '/');
    for (const canvas of canvases.values()) {
      if (canvas.filename === normalizedFilename && canvas.token === token) {
        return true;
      }
    }
    return false;
  }

  private removeLensCanvasMapping(mindId: string, filename: string): void {
    const lensViews = this.lensViewIdsByCanvas.get(mindId);
    lensViews?.delete(filename);
    if (lensViews?.size === 0) {
      this.lensViewIdsByCanvas.delete(mindId);
    }
  }

  private deleteCanvasFile(mindId: string, filename: string): void {
    const contentDir = this.getContentDirForMind(mindId);
    if (!contentDir) {
      return;
    }

    fs.rmSync(path.join(contentDir, filename), { force: true });
  }

  private totalCanvasCount(): number {
    let count = 0;
    for (const canvases of this.canvases.values()) {
      count += canvases.size;
    }
    return count;
  }

  private async stopServerIfIdle(): Promise<void> {
    if (this.totalCanvasCount() === 0 && this.server.isRunning()) {
      await this.server.stop();
    }
  }
}

function createCanvasToken(): string {
  return randomBytes(32).toString('base64url');
}

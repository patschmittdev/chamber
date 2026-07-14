import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasGestureGrant } from '@chamber/shared/canvas-action-types';
import { canonicalRequestJson } from '@chamber/shared/canvas-action-types';
import { CanvasServer } from './CanvasServer';

const tempDirs: string[] = [];

function makeMindDir(name = 'mind-1'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-canvas-server-'));
  const mindDir = path.join(root, name);
  fs.mkdirSync(mindDir, { recursive: true });
  tempDirs.push(root);
  return mindDir;
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ done: boolean; text: string }> {
  const { done, value } = await reader.read();
  return {
    done,
    text: value ? new TextDecoder().decode(value) : '',
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (reason: Error) => void } {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('CanvasServer', () => {
  let server: CanvasServer;
  const mindDirs = new Map<string, string>();
  const tokens = new Map<string, string>();
  const onAction = vi.fn();
  const onActionStatus = vi.fn();

  beforeEach(() => {
    mindDirs.clear();
    tokens.clear();
    onAction.mockReset();
    onActionStatus.mockReset();
    server = new CanvasServer({
      resolveContentDir: (mindId) => mindDirs.get(mindId) ?? null,
      onAction,
      onActionStatus,
      authorizeRequest: (mindId, filename, token) => tokens.get(`${mindId}:${filename}`) === token,
    });
  });

  afterEach(async () => {
    await server.stop();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('serves html with the bridge script injected', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    fs.writeFileSync(
      path.join(mindDir, 'report.html'),
      '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
      'utf8',
    );
    tokens.set('mind-1:report.html', 'secret-token');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/report.html?token=secret-token`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
    expect(html).toContain('--ch-background');
    expect(html).toContain('.ch-card');
    expect(html).toContain("new URLSearchParams(location.search).get('token')");
    expect(html).toContain("new EventSource('_sse?canvas=' + encodeURIComponent(canvasFile) + '&token='");
    expect(html).toContain("fetch('_action?canvas=' + encodeURIComponent(canvasFile) + '&token='");
    expect(html).toContain('chamber:canvas-action-status');
    expect(html).toContain('chamber:canvas-appearance');
  });

  it('supports targeted reload and close events over SSE', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');
    fs.writeFileSync(path.join(mindDir, 'report.html'), '<html><body>Hi</body></html>', 'utf8');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_sse?canvas=report.html&token=secret-token`);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Expected SSE response body');
    }

    const first = await readChunk(reader);
    expect(first.text).toContain('connected');

    server.reload('mind-1', 'report.html');
    const second = await readChunk(reader);
    expect(second.text).toContain('reload');

    server.closeClients('mind-1', 'report.html');
    const third = await readChunk(reader);
    expect(third.text).toContain('close');

    const fourth = await readChunk(reader);
    expect(fourth.done).toBe(true);
  });

  it('accepts browser actions before their asynchronous handler completes', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');
    const action = deferred();
    onAction.mockReturnValueOnce(action.promise);

    const now = Date.now();
    const acceptedRequest = { schemaVersion: 1 as const, variant: 'user-action' as const, label: 'button-clicked', fields: { id: 'approve' } };
    const grant: CanvasGestureGrant = {
      mindId: 'mind-1',
      viewId: 'v',
      actionVariant: 'user-action',
      nonce: 'test-nonce-accepts-' + now,
      expiresAt: now + 5000,
      issuedAt: now,
      requestHash: createHash('sha256').update(canonicalRequestJson(acceptedRequest)).digest('hex'),
    };
    server.registerGrant(grant);

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`, {
      body: JSON.stringify({
        request: acceptedRequest,
        grant,
        timestamp: 123,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      actionId: expect.any(String),
      ok: true,
      status: 'accepted',
    });
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user-action',
      canvas: 'report.html',
      data: { label: 'button-clicked', fields: { id: 'approve' } },
      mindId: 'mind-1',
      timestamp: 123,
    }));

    action.resolve();
  });

  it('publishes bounded lifecycle statuses without leaking handler failures', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');
    const action = deferred();
    onAction.mockReturnValueOnce(action.promise);

    const now = Date.now();
    const lifecycleRequest = { schemaVersion: 1 as const, variant: 'user-action' as const, label: 'add-todo', fields: { title: 'Write tests' } };
    const grant: CanvasGestureGrant = {
      mindId: 'mind-1',
      viewId: 'v',
      actionVariant: 'user-action',
      nonce: 'test-nonce-lifecycle-' + now,
      expiresAt: now + 5000,
      issuedAt: now,
      requestHash: createHash('sha256').update(canonicalRequestJson(lifecycleRequest)).digest('hex'),
    };
    server.registerGrant(grant);

    const port = await server.start();
    const stream = await fetch(`http://127.0.0.1:${port}/mind-1/_sse?canvas=report.html&token=secret-token`);
    const reader = stream.body?.getReader();
    if (!reader) throw new Error('Expected SSE response body');
    await readChunk(reader);

    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`, {
      body: JSON.stringify({ request: lifecycleRequest, grant }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const receipt = await response.json() as { actionId: string };
    const accepted = await readChunk(reader);

    expect(accepted.text).toContain('event: action-status');
    expect(accepted.text).toContain(`"actionId":"${receipt.actionId}"`);
    expect(accepted.text).toContain('"status":"accepted"');
    expect(onActionStatus).toHaveBeenCalledWith(expect.objectContaining({
      actionId: receipt.actionId,
      canvas: 'report.html',
      mindId: 'mind-1',
      status: 'accepted',
    }));

    action.reject(new Error('secret SDK failure'));
    const failed = await readChunk(reader);

    expect(failed.text).toContain('"status":"failed"');
    expect(failed.text).not.toContain('secret SDK failure');
    expect(onActionStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      actionId: receipt.actionId,
      status: 'failed',
    }));
  });

  it('rejects Canvas actions without the canvas token', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);
    tokens.set('mind-1:report.html', 'secret-token');

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/_action?canvas=report.html`, {
      body: JSON.stringify({ action: 'button-clicked' }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('rejects path traversal outside the mind content directory', async () => {
    const mindDir = makeMindDir();
    mindDirs.set('mind-1', mindDir);

    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/mind-1/..%2Fsecret.txt`);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });

  describe('gesture grant validation', () => {
    function validRequest() {
      return {
        schemaVersion: 1 as const,
        variant: 'user-action' as const,
        label: 'submit-form',
        fields: { id: 'item-1' },
      };
    }

    function requestHash(req: ReturnType<typeof validRequest>): string {
      return createHash('sha256').update(canonicalRequestJson(req)).digest('hex');
    }

    function makeGrant(overrides: Partial<CanvasGestureGrant> = {}): CanvasGestureGrant {
      const req = validRequest();
      return {
        mindId: 'mind-1',
        viewId: 'command-center',
        actionVariant: 'user-action',
        nonce: 'test-nonce-' + Math.random().toString(36).slice(2),
        expiresAt: Date.now() + 5000,
        issuedAt: Date.now(),
        requestHash: requestHash(req),
        ...overrides,
      };
    }

    function validBody(grant: CanvasGestureGrant) {
      return { request: validRequest(), grant };
    }

    it('rejects a token-only action without a grant before invoking any callback', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify({ action: 'button-clicked', data: {} }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(403);
      const body = await response.json() as { error: string };
      expect(body.error).toContain('renderer gesture grant');
      expect(onAction).not.toHaveBeenCalled();
    });

    it('rejects an expired grant', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      const expiredGrant = makeGrant({ expiresAt: Date.now() - 1 });
      server.registerGrant(expiredGrant);

      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify(validBody(expiredGrant)),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(403);
      const body = await response.json() as { error: string };
      expect(body.error).toMatch(/grant/i);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('rejects a replayed nonce (used grant)', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');
      onAction.mockResolvedValue(undefined);

      const port = await server.start();
      const grant = makeGrant();
      server.registerGrant(grant);

      // First use — should succeed
      const first = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify(validBody(grant)),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      expect(first.status).toBe(202);

      // Second use of same nonce — must be rejected
      const second = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify(validBody(grant)),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      expect(second.status).toBe(403);
      const body = await second.json() as { error: string };
      expect(body.error).toMatch(/grant/i);
    });

    it('rejects a grant with a mismatched mindId', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      // Grant is for mind-2 but action targets mind-1
      const grant = makeGrant({ mindId: 'mind-2' });
      server.registerGrant(grant);

      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify(validBody(grant)),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(403);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('rejects an unregistered grant (nonce not in registry)', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      const grant = makeGrant(); // Not registered with server.registerGrant()

      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify(validBody(grant)),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(403);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('accepts a valid grant and a bounded action request', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');
      onAction.mockResolvedValue(undefined);

      const port = await server.start();
      const grant = makeGrant();
      server.registerGrant(grant);

      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify(validBody(grant)),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(202);
      const body = await response.json() as { ok: boolean; actionId: string; status: string };
      expect(body.ok).toBe(true);
      expect(body.status).toBe('accepted');
      expect(onAction).toHaveBeenCalledOnce();
      // The action passed to onAction should contain the parsed request data
      const [calledAction] = onAction.mock.calls[0] as [{ action: string; data: unknown }];
      expect(calledAction.action).toBe('user-action');
    });

    it('rejects an action request with an unknown variant', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      const grant = makeGrant();
      server.registerGrant(grant);

      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify({
            request: { schemaVersion: 1, variant: 'exec-shell', command: 'rm -rf /' },
            grant,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(400);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('rejects a grant whose requestHash does not match the dispatched action', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      // Grant was approved for 'submit-form'. Canvas script swaps it to something else.
      const grant = makeGrant(); // hash = SHA-256 of validRequest() ('submit-form')
      server.registerGrant(grant);

      const swappedRequest = {
        schemaVersion: 1 as const,
        variant: 'user-action' as const,
        label: 'swapped-request',
        fields: { payload: 'injected' },
      };

      const response = await fetch(
        `http://127.0.0.1:${port}/mind-1/_action?canvas=report.html&token=secret-token`,
        {
          body: JSON.stringify({ request: swappedRequest, grant }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );

      expect(response.status).toBe(403);
      const body = await response.json() as { error: string };
      expect(body.error).toMatch(/hash/i);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('the bridge script returns the migration error for legacy sendAction calls', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);
      fs.writeFileSync(path.join(mindDir, 'report.html'), '<html><body>Hi</body></html>', 'utf8');
      tokens.set('mind-1:report.html', 'secret-token');

      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/mind-1/report.html?token=secret-token`);
      const html = await response.text();

      expect(html).toContain('renderer gesture grant');
      expect(html).toContain('Canvas API migration notes');
      // New API should be present
      expect(html).toContain('dispatchAction');
      expect(html).toContain('chamber:canvas-action-request');
    });
  });

  describe('symlink containment in static file serving', () => {
    function tryCreateSymlink(target: string, linkPath: string): boolean {
      try {
        fs.symlinkSync(target, linkPath);
        return true;
      } catch {
        return false;
      }
    }

    it('rejects a symlinked file inside the content directory', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);

      // Place a real file outside the mind dir.
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-canvas-outside-'));
      tempDirs.push(outsideDir);
      const secretFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secretFile, 'top secret', 'utf8');

      // Create a symlink inside the content dir pointing to the secret file.
      const linkPath = path.join(mindDir, 'secret-link.html');
      const canCreate = tryCreateSymlink(secretFile, linkPath);
      if (!canCreate) return; // Skip if symlinks require elevation.

      tokens.set('mind-1:secret-link.html', 'secret-token');
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/mind-1/secret-link.html?token=secret-token`);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden');
    });

    it('rejects a request where an ancestor directory inside the content dir is a symlink', async () => {
      const mindDir = makeMindDir();
      mindDirs.set('mind-1', mindDir);

      const realSubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-canvas-sub-'));
      tempDirs.push(realSubDir);
      fs.writeFileSync(path.join(realSubDir, 'page.html'), '<html>Sub</html>', 'utf8');

      // Symlink a subdirectory inside the mind dir to realSubDir.
      const linkedSub = path.join(mindDir, 'sub');
      const canCreate = tryCreateSymlink(realSubDir, linkedSub);
      if (!canCreate) return;

      tokens.set('mind-1:sub/page.html', 'secret-token');
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/mind-1/sub/page.html?token=secret-token`);

      expect(response.status).toBe(403);
    });
  });
});


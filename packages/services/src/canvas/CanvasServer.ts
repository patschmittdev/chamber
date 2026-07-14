import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { URL } from 'node:url';
import type { CanvasGestureGrant } from '@chamber/shared/canvas-action-types';
import { canonicalRequestJson, parseCanvasActionRequest } from '@chamber/shared/canvas-action-types';
import { assertContained } from '../fsContainment';
import type { CanvasAction, CanvasActionHandler, CanvasActionStatusEvent, CanvasServerLike } from './types';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const CANVAS_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

interface CanvasServerOptions {
  resolveContentDir: (mindId: string) => string | null;
  onAction: CanvasActionHandler;
  onActionStatus: (status: CanvasActionStatusEvent) => void;
  authorizeRequest: (mindId: string, filename: string, token: string | null) => boolean;
}

type CanvasClient = ServerResponse<IncomingMessage>;

const CHAMBER_CANVAS_STYLE = `
<style>
:root {
  color-scheme: dark;
  --ch-background: oklch(0.145 0.008 260);
  --ch-foreground: oklch(0.985 0 0);
  --ch-card: oklch(0.195 0.015 260);
  --ch-border: oklch(0.25 0.012 260);
  --ch-muted: oklch(0.255 0.015 260);
  --ch-muted-foreground: oklch(0.708 0.01 260);
  --ch-accent: oklch(0.255 0.015 260);
  --ch-genesis: oklch(0.72 0.15 160);
  --ch-radius: 0.75rem;
  --ch-font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --ch-font-mono: "JetBrains Mono", ui-monospace, monospace;
}
:root[data-chamber-theme="light"] {
  color-scheme: light;
  --ch-background: oklch(0.985 0.002 260);
  --ch-foreground: oklch(0.145 0.008 260);
  --ch-card: oklch(1 0 0);
  --ch-border: oklch(0.88 0.008 260);
  --ch-muted: oklch(0.94 0.006 260);
  --ch-muted-foreground: oklch(0.45 0.012 260);
  --ch-accent: oklch(0.92 0.008 260);
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  background: var(--ch-background);
  color: var(--ch-foreground);
  font-family: var(--ch-font-sans);
}
.ch-page { min-height: 100vh; padding: 1.5rem; background: var(--ch-background); color: var(--ch-foreground); }
.ch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; }
.ch-card { border: 1px solid var(--ch-border); border-radius: var(--ch-radius); background: var(--ch-card); padding: 1rem; }
.ch-muted { color: var(--ch-muted-foreground); }
.ch-button, .ch-button-secondary {
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
  font: inherit;
  padding: 0.5rem 0.75rem;
}
.ch-button { background: var(--ch-foreground); color: var(--ch-background); }
.ch-button-secondary { background: var(--ch-muted); color: var(--ch-foreground); }
.ch-input {
  width: 100%;
  border: 1px solid var(--ch-border);
  border-radius: 0.5rem;
  background: var(--ch-muted);
  color: var(--ch-foreground);
  font: inherit;
  padding: 0.5rem 0.75rem;
}
.ch-table { width: 100%; border-collapse: collapse; }
.ch-table th, .ch-table td { border-bottom: 1px solid var(--ch-border); padding: 0.625rem; text-align: left; }
.ch-badge { border: 1px solid var(--ch-border); border-radius: 999px; display: inline-flex; padding: 0.125rem 0.5rem; color: var(--ch-muted-foreground); }
</style>`;

// ---------------------------------------------------------------------------
// Pending grant registry
// ---------------------------------------------------------------------------

const GRANT_TTL_MS = 30_000;

interface StoredGrant {
  grant: CanvasGestureGrant;
  used: boolean;
  registeredAt: number;
}

class PendingGrantRegistry {
  private readonly entries = new Map<string, StoredGrant>();

  register(grant: CanvasGestureGrant): void {
    this.prune();
    this.entries.set(grant.nonce, { grant, used: false, registeredAt: Date.now() });
  }

  /**
   * Validates the grant against the expected mindId and request hash, marks it
   * as used if valid. Returns an error string if invalid, or null if valid.
   */
  validateAndConsume(grant: CanvasGestureGrant, expectedMindId: string, expectedRequestHash: string): string | null {
    this.prune();
    const stored = this.entries.get(grant.nonce);
    if (!stored) {
       return 'Grant nonce not registered';
    }
    if (stored.used) {
       return 'Grant nonce already used';
    }
    if (Date.now() > stored.grant.expiresAt) {
       return 'Grant expired';
    }
    if (stored.grant.mindId !== expectedMindId) {
       return 'Grant mindId does not match request';
    }
    if (stored.grant.requestHash !== expectedRequestHash) {
       return 'Grant request hash does not match dispatched action';
    }
    stored.used = true;
    return null;
  }

  private prune(): void {
    const cutoff = Date.now() - GRANT_TTL_MS;
    for (const [nonce, entry] of this.entries) {
       if (entry.registeredAt < cutoff) {
         this.entries.delete(nonce);
       }
    }
  }
}

// ---------------------------------------------------------------------------
// Bridge script injected into every Canvas HTML document
// ---------------------------------------------------------------------------

function buildBridgeScript(filename: string): string {
  return `
<script>
(function() {
  var canvasFile = ${JSON.stringify(filename)};
  var canvasToken = new URLSearchParams(location.search).get('token') || '';
  var parentOrigin = null; // Set on first trusted appearance message from the parent
  var pendingGrant = null; // Single-use grant received from the parent renderer

  var es = new EventSource('_sse?canvas=' + encodeURIComponent(canvasFile) + '&token=' + encodeURIComponent(canvasToken));
  es.onmessage = function(e) {
    if (e.data === 'reload') { location.reload(); }
    if (e.data === 'close') { window.close(); }
  };

  function emitActionStatus(payload) {
   if (!payload || typeof payload.actionId !== 'string') return;
   if (payload.status !== 'accepted' && payload.status !== 'running' && payload.status !== 'completed' && payload.status !== 'failed') return;
   window.dispatchEvent(new CustomEvent('chamber:canvas-action-status', { detail: payload }));
  }

  es.addEventListener('action-status', function(e) {
   try {
      emitActionStatus(JSON.parse(e.data));
   } catch (_) {
      // Ignore malformed loopback events rather than exposing untrusted payloads.
   }
  });

  window.addEventListener('message', function(e) {
   if (e.source !== window.parent) return;
   if (!e.origin || e.origin === 'null') return;

   var payload = e.data;
   if (!payload || typeof payload !== 'object') return;

   if (payload.type === 'chamber:canvas-appearance') {
      if (payload.theme !== 'light' && payload.theme !== 'dark') return;
      // Record the trusted parent origin on first valid appearance message.
      if (parentOrigin === null) parentOrigin = e.origin;
      if (e.origin !== parentOrigin) return;
      document.documentElement.dataset.chamberTheme = payload.theme;
      return;
   }

   if (payload.type === 'chamber:canvas-gesture-grant') {
      // Only accept from the established trusted parent origin.
      if (parentOrigin !== null && e.origin !== parentOrigin) return;
      var grant = payload.grant;
      if (!grant || typeof grant !== 'object') return;
      if (typeof grant.nonce !== 'string' || !grant.nonce) return;
      if (typeof grant.expiresAt !== 'number' || Date.now() > grant.expiresAt) return;
      // Store for single use.
      pendingGrant = grant;
   }
  });

  window.canvas = {
   /**
    * DEPRECATED: Canvas scripts must call requestAction() instead.
    * This method is kept for backwards compatibility but always rejects to
    * surface the migration message clearly.
    */
   sendAction: function(_name, _data) {
      return Promise.reject(new Error(
        'Action requires a renderer gesture grant. See Canvas API migration notes.'
      ));
   },

   /**
    * Request an action. The Canvas bridge notifies the parent renderer, which
    * shows an Approve button. Once the user approves, the renderer sends a
    * gesture grant back and the action is dispatched automatically.
    *
    * @param {object} request - CanvasActionRequest (schemaVersion, variant, label, fields)
    * @param {function=} onResult - Called with { status: 'approved'|'rejected' }
    */
   requestAction: function(request, onResult) {
      if (!parentOrigin) {
        if (onResult) onResult({ status: 'rejected', reason: 'parent origin not established' });
        return;
      }
      // Store callback so it can be called when the grant arrives.
      window.canvas._pendingRequest = request;
      window.canvas._pendingOnResult = onResult || null;
      window.parent.postMessage({
        type: 'chamber:canvas-action-request',
        request: request
      }, parentOrigin);
   },

   /**
    * Dispatch an action using the pending grant that was sent by the renderer.
    * Called internally when the grant arrives after requestAction().
    * Canvas scripts can also call this directly if they already hold a grant.
    *
    * @param {object} grant - CanvasGestureGrant
    * @param {object} request - CanvasActionRequest
    */
   dispatchAction: function(grant, request) {
      if (!grant || typeof grant.nonce !== 'string') {
        return Promise.reject(new Error('Invalid grant'));
      }
      return fetch('_action?canvas=' + encodeURIComponent(canvasFile) + '&token=' + encodeURIComponent(canvasToken), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request, grant: grant, timestamp: Date.now() })
      });
   },

   onActionStatus: function(listener) {
      var handler = function(e) { listener(e.detail); };
      window.addEventListener('chamber:canvas-action-status', handler);
      return function() { window.removeEventListener('chamber:canvas-action-status', handler); };
   },

   // Internal: set by requestAction, cleared after use.
   _pendingRequest: null,
   _pendingOnResult: null,
  };

  // When the renderer sends a grant in response to requestAction(), auto-dispatch.
  window.addEventListener('message', function(e) {
   if (e.source !== window.parent) return;
   if (!e.origin || e.origin === 'null') return;
   if (parentOrigin !== null && e.origin !== parentOrigin) return;
   var payload = e.data;
   if (!payload || payload.type !== 'chamber:canvas-gesture-grant') return;

   var storedRequest = window.canvas._pendingRequest;
   var storedCallback = window.canvas._pendingOnResult;
   if (!storedRequest) return;

   // Clear before dispatch to prevent double use.
   window.canvas._pendingRequest = null;
   window.canvas._pendingOnResult = null;

   window.canvas.dispatchAction(payload.grant, storedRequest).then(function(r) {
      if (storedCallback) storedCallback({ status: r.ok ? 'approved' : 'rejected' });
   }).catch(function() {
      if (storedCallback) storedCallback({ status: 'rejected' });
   });
  });
})();
</script>`;
}

function injectBridge(html: string, filename: string): string {
  const bridgeScript = buildBridgeScript(filename);
  const additions = `${CHAMBER_CANVAS_STYLE}\n${bridgeScript}`;
  if (html.includes('</head>')) {
    const withStyle = html.replace('</head>', `${CHAMBER_CANVAS_STYLE}\n</head>`);
    if (withStyle.includes('</body>')) {
      return withStyle.replace('</body>', `${bridgeScript}\n</body>`);
    }
    return `${withStyle}${bridgeScript}`;
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${additions}\n</body>`);
  }
  if (html.includes('</html>')) {
    return html.replace('</html>', `${additions}\n</html>`);
  }
  return `${html}${additions}`;
}

function readRequestBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export class CanvasServer implements CanvasServerLike {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly sseClients = new Map<string, Set<CanvasClient>>();
  private readonly grantRegistry = new PendingGrantRegistry();

  constructor(private readonly options: CanvasServerOptions) {}

  /**
   * Register a gesture grant issued by the renderer. Must be called before the
   * renderer transmits the grant to the Canvas iframe so the server can validate
   * it when the action arrives.
   */
  registerGrant(grant: CanvasGestureGrant): void {
    this.grantRegistry.register(grant);
  }

  async start(): Promise<number> {
    if (this.server) {
      if (this.port === null) {
        throw new Error('Canvas server is running without a bound port');
      }
      return this.port;
    }

    return new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Canvas server failed to bind to a TCP port'));
          return;
        }

        this.server = server;
        this.port = address.port;
        resolve(address.port);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.closeClients();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    this.server = null;
    this.port = null;
    this.sseClients.clear();
  }

  reload(mindId?: string, filename?: string): void {
    this.broadcast('reload', mindId, filename);
  }

  closeClients(mindId?: string, filename?: string): void {
    const entries = this.matchingClientEntries(mindId, filename);
    for (const [key, clients] of entries) {
      for (const client of clients) {
        try {
          client.write('data: close\n\n');
          client.end();
        } catch {
          // Ignore client disconnect races during close.
        }
      }
      this.sseClients.delete(key);
    }
  }

  getPort(): number | null {
    return this.port;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const segments = requestUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (segments.length === 0) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const [mindId, ...rest] = segments;
    if (!mindId) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (rest.length === 1 && rest[0] === '_sse') {
      this.handleSse(req, res, mindId, requestUrl.searchParams.get('canvas'), requestUrl.searchParams.get('token'));
      return;
    }

    if (rest.length === 1 && rest[0] === '_action') {
      await this.handleAction(req, res, mindId, requestUrl.searchParams.get('canvas'), requestUrl.searchParams.get('token'));
      return;
    }

    this.handleStaticFile(res, mindId, rest, requestUrl.searchParams.get('token'));
  }

  private handleSse(req: IncomingMessage, res: ServerResponse, mindId: string, filename: string | null, token: string | null): void {
    if (!filename) {
      res.writeHead(400);
      res.end('Missing canvas query parameter');
      return;
    }
    if (!this.options.authorizeRequest(mindId, filename, token)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    res.write('data: connected\n\n');

    this.addClient(mindId, filename, res);
    req.on('close', () => {
      this.removeClient(mindId, filename, res);
    });
  }

  private async handleAction(req: IncomingMessage, res: ServerResponse, mindId: string, filename: string | null, token: string | null): Promise<void> {
    if (!filename) {
      res.writeHead(400);
      res.end('{"error":"missing canvas"}');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('{"error":"method not allowed"}');
      return;
    }
    if (!this.options.authorizeRequest(mindId, filename, token)) {
      res.writeHead(403);
      res.end('{"error":"forbidden"}');
      return;
    }
    if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
      res.writeHead(415);
      res.end('{"error":"unsupported media type"}');
      return;
    }

    let body: string;
    try {
      body = await readRequestBody(req);
    } catch {
      res.writeHead(400);
      res.end('{"error":"request body too large or unreadable"}');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid json"}');
      return;
    }

    // --- Gesture grant shape check (structural only — consume happens after hash) ---
    const rawGrant = parsed.grant;
    if (!rawGrant || typeof rawGrant !== 'object' || Array.isArray(rawGrant)) {
      res.writeHead(403);
      res.end(JSON.stringify({
        error: 'Action requires a renderer gesture grant. See Canvas API migration notes.',
      }));
      return;
    }
    const grant = rawGrant as Record<string, unknown>;
    if (typeof grant.nonce !== 'string' || !grant.nonce ||
        typeof grant.mindId !== 'string' || typeof grant.expiresAt !== 'number' ||
        typeof grant.requestHash !== 'string' || !grant.requestHash) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Malformed gesture grant' }));
      return;
    }

    // --- Bounded action schema validation (before consuming the nonce) ---
    const rawRequest = parsed.request;
    let actionRequest: ReturnType<typeof parseCanvasActionRequest>;
    try {
      actionRequest = parseCanvasActionRequest(rawRequest);
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: `Invalid action request: ${err instanceof Error ? err.message : 'parse error'}` }));
      return;
    }

    // --- Grant consume (validates nonce, expiry, mindId, and request hash) ---
    const expectedHash = createHash('sha256').update(canonicalRequestJson(actionRequest)).digest('hex');
    const grantError = this.grantRegistry.validateAndConsume(grant as unknown as CanvasGestureGrant, mindId, expectedHash);
    if (grantError) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: `Invalid gesture grant: ${grantError}` }));
      return;
    }

    const actionId = randomUUID();
    const action: CanvasAction = {
      mindId,
      canvas: filename,
      action: actionRequest.variant,
      data: { label: actionRequest.label, fields: actionRequest.fields },
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      actionId,
    };
    this.publishActionStatus(action, 'accepted');
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, actionId, status: 'accepted' }));
    void this.dispatchAction(action);
  }

  private handleStaticFile(res: ServerResponse, mindId: string, segments: string[], token: string | null): void {
    const contentDir = this.options.resolveContentDir(mindId);
    if (!contentDir) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const relativePath = segments.length === 0 ? 'index.html' : path.join(...segments);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');

    // Use realpath-based containment to reject traversal, symlinks, and junctions.
    let fullPath: string;
    try {
      fullPath = assertContained(contentDir, normalizedRelativePath);
    } catch {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!this.options.authorizeRequest(mindId, normalizedRelativePath, token)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      let content: Buffer | string = fs.readFileSync(fullPath);
      const extension = path.extname(fullPath).toLowerCase();
      const mimeType = MIME_TYPES[extension] ?? 'application/octet-stream';

      if (extension === '.html') {
        content = injectBridge(content.toString('utf8'), normalizedRelativePath);
      }

      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': CANVAS_CONTENT_SECURITY_POLICY,
        'Content-Type': mimeType,
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
  }

  private broadcast(message: 'reload' | 'close', mindId?: string, filename?: string): void {
    const entries = this.matchingClientEntries(mindId, filename);
    for (const [, clients] of entries) {
      for (const client of clients) {
        try {
          client.write(`data: ${message}\n\n`);
        } catch {
          // Ignore client disconnect races during broadcast.
        }
      }
    }
  }

  private async dispatchAction(action: CanvasAction): Promise<void> {
    this.publishActionStatus(action, 'running');
    try {
      await this.options.onAction(action);
      this.publishActionStatus(action, 'completed');
    } catch {
      this.publishActionStatus(action, 'failed');
    }
  }

  private publishActionStatus(action: CanvasAction, status: CanvasActionStatusEvent['status']): void {
    const statusEvent: CanvasActionStatusEvent = {
      mindId: action.mindId,
      canvas: action.canvas,
      actionId: action.actionId,
      status,
    };
    this.options.onActionStatus(statusEvent);
    const clients = this.sseClients.get(this.clientKey(action.mindId, action.canvas));
    if (!clients) return;
    const payload = JSON.stringify({ actionId: action.actionId, status });
    for (const client of clients) {
      try {
        client.write(`event: action-status\ndata: ${payload}\n\n`);
      } catch {
        // Ignore client disconnect races while publishing a bounded status.
      }
    }
  }

  private addClient(mindId: string, filename: string, client: CanvasClient): void {
    const key = this.clientKey(mindId, filename);
    const clients = this.sseClients.get(key) ?? new Set<CanvasClient>();
    clients.add(client);
    this.sseClients.set(key, clients);
  }

  private removeClient(mindId: string, filename: string, client: CanvasClient): void {
    const key = this.clientKey(mindId, filename);
    const clients = this.sseClients.get(key);
    if (!clients) {
      return;
    }

    clients.delete(client);
    if (clients.size === 0) {
      this.sseClients.delete(key);
    }
  }

  private matchingClientEntries(mindId?: string, filename?: string): Array<[string, Set<CanvasClient>]> {
    if (mindId && filename) {
      const clients = this.sseClients.get(this.clientKey(mindId, filename));
      return clients ? [[this.clientKey(mindId, filename), clients]] : [];
    }

    if (mindId) {
      const prefix = `${mindId}:`;
      return [...this.sseClients.entries()].filter(([key]) => key.startsWith(prefix));
    }

    return [...this.sseClients.entries()];
  }

  private clientKey(mindId: string, filename: string): string {
    return `${mindId}:${filename}`;
  }
}

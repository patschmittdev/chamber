import { Hono } from 'hono';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { Context } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  addMindHandler,
  cancelChatHandler,
  getAuthStatusHandler,
  getConfigHandler,
  getGenesisStatusHandler,
  healthHandler,
  listAuthAccountsHandler,
  listChamberToolsHandler,
  listLensViewsHandler,
  listModelsHandler,
  listMindsHandler,
  logoutAuthHandler,
  newConversationHandler,
  sendChatHandler,
  switchAuthAccountHandler,
  uploadAttachmentHandler,
} from './handlers';
import { isAllowedOrigin, isAuthorized, isLoopbackHost } from './auth';
import type { ChamberCtx, ChamberRequest, ChamberResponse } from './types';
import { WIRE_PROTOCOL_VERSION } from '@chamber/wire-contracts';

function toRequest(c: Context): ChamberRequest {
  const url = new URL(c.req.url);
  return {
    method: c.req.method,
    path: url.pathname,
    query: url.searchParams,
    headers: c.req.raw.headers,
  };
}

async function toRequestWithBody(c: Context): Promise<ChamberRequest> {
  const request = toRequest(c);
  if (c.req.header('content-type')?.includes('application/json')) {
    return { ...request, body: await c.req.json() };
  }
  return { ...request, body: await c.req.arrayBuffer() };
}

function send(c: Context, response: ChamberResponse): Response {
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    c.header(name, value);
  }
  return c.json(response.body ?? null, response.status as 200);
}

function streamAuthLogin(ctx: ChamberCtx): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void ctx.startAuthLogin((progress) => write({ type: 'progress', progress }))
        .then((result) => write({ type: 'result', result }))
        .catch((error: unknown) => {
          const message = getErrorMessage(error);
          write({ type: 'result', result: { success: false, error: message } });
        })
        .finally(() => controller.close());
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function requireAuth(c: Context, ctx: ChamberCtx): Response | null {
  if (!isLoopbackHost(c.req.header('host'))) {
    return c.json({ error: 'Forbidden host' }, 403);
  }
  if (!isAllowedOrigin(c.req.header('origin') ?? null, ctx.allowedOrigins)) {
    return c.json({ error: 'Forbidden origin' }, 403);
  }
  if (!isAuthorized(c.req.header('authorization') ?? null, ctx.token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

export function createHonoApp(ctx: ChamberCtx): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => send(c, await healthHandler()));
  const authenticated = (handler: (request: ChamberRequest, context: ChamberCtx) => Promise<ChamberResponse>) => async (c: Context) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await handler(toRequest(c), ctx));
  };

  app.get('/api/mind/list', authenticated(listMindsHandler));
  app.post('/api/mind/add', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await addMindHandler(await toRequestWithBody(c), ctx));
  });
  app.get('/api/config', authenticated(getConfigHandler));
  app.get('/api/lens/list', authenticated(listLensViewsHandler));
  app.get('/api/genesis/status', authenticated(getGenesisStatusHandler));
  app.get('/api/auth/status', authenticated(getAuthStatusHandler));
  app.get('/api/auth/accounts', authenticated(listAuthAccountsHandler));
  app.post('/api/auth/login', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return streamAuthLogin(ctx);
  });
  app.post('/api/auth/switch', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await switchAuthAccountHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/auth/logout', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await logoutAuthHandler(toRequest(c), ctx));
  });
  app.get('/api/chamber-tools/list', authenticated(listChamberToolsHandler));
  app.post('/api/attachments', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await uploadAttachmentHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/chat/cancel', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await cancelChatHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/chat/send', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await sendChatHandler(await toRequestWithBody(c), ctx));
  });
  app.post('/api/chat/new', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    return send(c, await newConversationHandler(await toRequestWithBody(c), ctx));
  });
  app.get('/api/chat/models', authenticated(listModelsHandler));
  app.post('/api/shutdown', async (c) => {
    const authFailure = requireAuth(c, ctx);
    if (authFailure) return authFailure;
    setTimeout(() => ctx.shutdown(), 0);
    return c.json({ ok: true });
  });
  app.get('*', (c) => c.html('<!doctype html><html><body><h1>Chamber server</h1></body></html>'));

  return app;
}

export function createHttpServer(ctx: ChamberCtx) {
  const app = createHonoApp(ctx);
  const server = createServer(getRequestListener((request) => app.fetch(request)));
  const wsServer = new WebSocketServer({ noServer: true });
  const subscriptions = new Map<string, Set<import('ws').WebSocket>>();
  const publish = (sessionId: string, event: unknown): void => {
    ctx.publish?.(sessionId, event);
    for (const ws of subscriptions.get(sessionId) ?? []) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ version: WIRE_PROTOCOL_VERSION, type: 'chat:event', payload: event }));
      }
    }
  };

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const host = request.headers.host;
    const origin = request.headers.origin ?? null;
    const authorization = request.headers.authorization ?? (
      requestUrl.searchParams.has('token') ? `Bearer ${requestUrl.searchParams.get('token')}` : null
    );
    if (!isLoopbackHost(host) || !isAllowedOrigin(origin, ctx.allowedOrigins) || !isAuthorized(authorization, ctx.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'hello', version: 1 }));
      const subscribed = new Set<string>();
      // Trust boundary: this loopback server is single-user and gated by the
      // per-launch bearer token plus the origin and host checks on the upgrade
      // above. It does not yet bind a subscription to the connection that
      // created the session, so any authenticated connection can subscribe to
      // any sessionId it names. That is acceptable only under the single-user
      // assumption. Per-connection ownership needs the authenticated-identity
      // handshake tracked as follow-up F0b (token cookie / WS subprotocol);
      // narrow this to connection-owned sessions once that lands.
      ws.on('message', (data) => {
        let message: { type?: unknown; sessionId?: unknown };
        try {
          const parsed: unknown = JSON.parse(data.toString());
          if (typeof parsed !== 'object' || parsed === null) return;
          message = parsed as { type?: unknown; sessionId?: unknown };
        } catch {
          // Drop malformed frames instead of letting an uncaught exception
          // crash the loopback server for every connected session.
          return;
        }
        if (message.type === 'subscribe' && typeof message.sessionId === 'string' && message.sessionId.length > 0) {
          const sessionId = message.sessionId;
          subscribed.add(sessionId);
          const sockets = subscriptions.get(sessionId) ?? new Set();
          sockets.add(ws);
          subscriptions.set(sessionId, sockets);
          ws.send(JSON.stringify({ version: 1, type: 'subscription:ready', payload: { sessionId } }));
        }
      });
      ws.on('close', () => {
        for (const sessionId of subscribed) {
          const sockets = subscriptions.get(sessionId);
          sockets?.delete(ws);
          if (sockets?.size === 0) subscriptions.delete(sessionId);
        }
      });
    });
  });

  return { server, wsServer, publish };
}

/**
 * WebSocket upgrade handler for /api/workspaces/chat — the structured chat
 * transport, parallel to the raw-byte PTY WS in `workspaces-ws.ts`.
 *
 * Same upgrade/auth/origin gate as the PTY endpoint (reused verbatim), but the
 * frames are JSON chat messages (see `chat-protocol.ts`), not terminal bytes:
 * it binds the socket to a live `ChatSession` in `svc.chat` and lets the
 * session pump events out / user messages in.
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { URL } from 'node:url';

import { WebSocketServer, type WebSocket } from 'ws';

import { logger as launcherLogger } from '../workspaces/logger.js';
import type { WorkspaceService } from '../workspaces/service.js';
import { isUpgradeAuthorized, isWsOriginAllowed } from './workspaces-ws.js';

const WS_PATH = '/api/workspaces/chat';

export interface AttachedChatWS {
  dispose(): void;
}

export function attachWorkspacesChatWS(httpServer: HttpServer, svc: WorkspaceService): AttachedChatWS {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: import('node:net').Socket, head: Buffer): void => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== WS_PATH) return; // not ours — leave for other listeners

    if (svc.isShuttingDown()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!isWsOriginAllowed(req.headers.origin, req.headers.host, svc.config)) {
      launcherLogger.warn('chat.upgrade.origin_rejected', {
        origin: req.headers.origin ?? null,
        host: req.headers.host ?? null,
      });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    isUpgradeAuthorized(req).then((authorized) => {
      if (!authorized) {
        launcherLogger.warn('chat.upgrade.auth_rejected', {
          remoteAddress: req.socket.remoteAddress ?? null,
        });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, url);
      });
    }).catch((err) => {
      launcherLogger.error('chat.upgrade.auth_check_failed', { err });
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  };

  httpServer.on('upgrade', onUpgrade);

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, url: URL) => {
    const sessionId = (url.searchParams.get('session') ?? '').slice(0, 64);
    if (!sessionId) {
      try { ws.close(4000, 'session id required'); } catch { /* ignore */ }
      return;
    }
    // Rehydrating (not just `chat.get`) is what makes a chat survive a restart:
    // after a reboot no session is live, but the record + its persisted
    // transcript are on disk, so this replays the conversation and re-arms the
    // agent lazily. A genuinely unknown id still 4404s.
    void svc.ensureChatSession(sessionId).then((session) => {
      if (!session) {
        launcherLogger.warn('chat.upgrade.unknown_session', { sessionId });
        try { ws.close(4404, 'session not found'); } catch { /* ignore */ }
        return;
      }
      launcherLogger.event('chat.upgrade.accepted', { sessionId, wsId: session.wsId });
      try {
        session.attach(ws);
      } catch (err) {
        launcherLogger.error('chat.attach_failed', { sessionId, err });
        try { ws.close(1011, 'attach failed'); } catch { /* ignore */ }
      }
    }).catch((err: unknown) => {
      launcherLogger.error('chat.ensure_failed', { sessionId, err });
      try { ws.close(1011, 'attach failed'); } catch { /* ignore */ }
    });
  });

  return {
    dispose: () => {
      httpServer.off('upgrade', onUpgrade);
      wss.close();
    },
  };
}

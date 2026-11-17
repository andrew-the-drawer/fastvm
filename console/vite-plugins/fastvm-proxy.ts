import http from "node:http";
import net from "node:net";
import type { IncomingMessage, Server as NodeHttpServer, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { HttpServer, Plugin } from "vite";

/** Default fastvmd unix socket (matches the daemon default). */
const DEFAULT_SOCKET_PATH = "/run/fastvm/fastvm.sock";

/** Only requests/upgrades under this prefix are proxied; everything else is Vite's. */
const API_PREFIX = "/v1/";

type NextFunction = (err?: unknown) => void;

function sendUnavailable(res: ServerResponse, err: Error): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  if (res.headersSent) {
    res.destroy(err);
    return;
  }
  const body = JSON.stringify({ error: `fastvmd unavailable: ${err.message}` });
  res.statusCode = 502;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

/** Serialize the original upgrade request line and headers for replay upstream. */
function serializeRequestHead(req: IncomingMessage): string {
  const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
  // rawHeaders keeps duplicate/ordered headers (Sec-WebSocket-* etc.) intact.
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/**
 * Tunnel WebSocket upgrades for `/v1/*` to the fastvmd unix socket.
 *
 * Vite may also attach upgrade listeners (HMR); we deliberately ignore
 * non-`/v1/` paths so the dev client keeps working. Non-HTTP leaves (HMR) are
 * left untouched.
 */
function attachUpgradeProxy(httpServer: HttpServer | null | undefined, socketPath: string): void {
  if (httpServer === null || httpServer === undefined) {
    return;
  }

  (httpServer as NodeHttpServer).on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
      const url = req.url ?? "/";
      if (!url.startsWith(API_PREFIX) || socket.destroyed) {
        return;
      }

      const upstream = net.connect({ path: socketPath });
      let settled = false;

      const teardown = (err?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        upstream.destroy();
        if (!socket.destroyed) {
          socket.destroy(err);
        }
      };

      upstream.once("connect", () => {
        upstream.write(serializeRequestHead(req));
        if (head.length > 0) {
          upstream.write(head);
        }
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.once("error", (err: NodeJS.ErrnoException) => {
        teardown(err);
      });
      upstream.once("close", () => {
        teardown();
      });
      socket.once("error", () => {
        teardown();
      });
      socket.once("close", () => {
        teardown();
      });
    },
  );
}

/**
 * Vite plugin that forwards same-origin `/v1/*` HTTP requests and WebSocket
 * upgrades to the fastvmd unix socket. It is installed in both the dev server
 * and `vp preview`, so the browser always talks to the API same-origin (no
 * CORS, no config in the app).
 *
 * The socket path comes from the server-side `FASTVM_SOCKET` environment
 * variable, defaulting to `/run/fastvm/fastvm.sock`.
 */
export function fastvmProxy(): Plugin {
  const socketPath = process.env.FASTVM_SOCKET || DEFAULT_SOCKET_PATH;

  const middleware = (req: IncomingMessage, res: ServerResponse, next: NextFunction): void => {
    const url = req.url ?? "/";
    if (!url.startsWith(API_PREFIX)) {
      next();
      return;
    }

    const upstream = http.request(
      {
        socketPath,
        path: url,
        method: req.method ?? "GET",
        headers: { ...req.headers, host: "localhost" },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.on("error", (err) => {
          res.destroy(err);
        });
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", (err: NodeJS.ErrnoException) => {
      sendUnavailable(res, err);
    });
    // If the browser goes away mid-request, stop waiting on the daemon.
    res.on("close", () => {
      upstream.destroy();
    });
    req.pipe(upstream);
  };

  return {
    name: "fastvm:unix-socket-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
      attachUpgradeProxy(server.httpServer, socketPath);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      attachUpgradeProxy(server.httpServer, socketPath);
    },
  };
}

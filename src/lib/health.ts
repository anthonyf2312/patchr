import { createServer, type Server } from 'node:http';

export interface HealthStatus {
  ok: boolean;
  [detail: string]: unknown;
}

/** GET /healthz answers 200 when healthy and 503 when not, for Docker's HEALTHCHECK and uptime monitors. */
export function startHealthServer(port: number, check: () => HealthStatus): Server {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/healthz') {
      response.writeHead(404).end();
      return;
    }
    const status = check();
    response
      .writeHead(status.ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify(status));
  });
  server.listen(port);
  return server;
}

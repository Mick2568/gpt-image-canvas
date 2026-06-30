import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { closeAllAgentSessions } from "./domain/agent/websocket-session.js";
import { closeDatabase } from "./infrastructure/database.js";
import { runtimePaths, serverConfig } from "./infrastructure/runtime.js";
import { agentWebSocketServer, app } from "./server/app.js";

export { agentWebSocketServer, app } from "./server/app.js";

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  const modulePath = fileURLToPath(import.meta.url);
  return [resolve(process.cwd(), entry), resolve(runtimePaths.packageRoot, entry)].some(
    (entryPath) => entryPath === modulePath
  );
}

if (isMainModule()) {
  const server = serve(
    {
      fetch: app.fetch,
      websocket: { server: agentWebSocketServer },
      hostname: serverConfig.host,
      port: serverConfig.port
    },
    (info) => {
      console.log(`API listening at http://${info.address}:${info.port}`);
    }
  );

  const shutdown = (): void => {
    closeAllAgentSessions("server_shutdown");
    agentWebSocketServer.close();
    closeDatabase();
    server.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

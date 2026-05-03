import { randomUUID } from "node:crypto";
import type { WSEvents, WSContext, WSMessageReceive } from "hono/ws";
import type {
  AgentClientMessage,
  AgentClientMessageType,
  AgentErrorEvent,
  AgentServerEvent
} from "./contracts.js";
import { getUsableAgentLlmConfig } from "./agent-config.js";

const OPEN_READY_STATE = 1;
const CLIENT_MESSAGE_TYPES: readonly AgentClientMessageType[] = [
  "user_message",
  "revise_plan",
  "execute_plan",
  "cancel_run",
  "retry_failed",
  "ping"
];
const AGENT_WORK_MESSAGE_TYPES = new Set<AgentClientMessageType>([
  "user_message",
  "revise_plan",
  "execute_plan",
  "retry_failed"
]);

interface ActiveAgentRun {
  id: string;
  controller: AbortController;
  cancelled: boolean;
}

interface AgentSocketSession {
  connectionId: string;
  activeRun?: ActiveAgentRun;
}

interface ParsedMessage {
  ok: true;
  value: AgentClientMessage;
}

interface MessageParseError {
  ok: false;
  code: string;
  message: string;
}

const sessions = new Map<string, AgentSocketSession>();

export function createAgentWebSocketEvents(): WSEvents {
  const session: AgentSocketSession = {
    connectionId: randomUUID()
  };

  return {
    onOpen(_event, ws) {
      sessions.set(session.connectionId, session);
      sendEvent(ws, {
        type: "connected",
        connectionId: session.connectionId,
        timestamp: new Date().toISOString()
      });
    },
    onMessage(event, ws) {
      handleAgentMessage(event.data, ws, session);
    },
    onClose() {
      cancelActiveRun(session, "socket_disconnected");
      sessions.delete(session.connectionId);
    },
    onError() {
      cancelActiveRun(session, "socket_error");
      sessions.delete(session.connectionId);
    }
  };
}

export function closeAllAgentSessions(reason = "server_shutdown"): void {
  for (const session of sessions.values()) {
    cancelActiveRun(session, reason);
  }
  sessions.clear();
}

function handleAgentMessage(data: WSMessageReceive, ws: WSContext, session: AgentSocketSession): void {
  const parsed = parseAgentClientMessage(data);
  if (!parsed.ok) {
    sendError(ws, {
      code: parsed.code,
      message: parsed.message,
      recoverable: true
    });
    return;
  }

  const message = parsed.value;
  if (message.type === "ping") {
    sendEvent(ws, {
      type: "pong",
      requestId: message.requestId,
      runId: message.runId,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (message.type === "cancel_run") {
    const cancelled = cancelActiveRun(session, "client_cancelled", message.runId);
    sendEvent(ws, {
      type: "run_cancelled",
      requestId: message.requestId,
      runId: cancelled.runId,
      reason: cancelled.reason,
      alreadyCancelled: cancelled.alreadyCancelled,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (AGENT_WORK_MESSAGE_TYPES.has(message.type)) {
    handleAgentWorkMessage(message, ws);
    return;
  }

  sendError(ws, {
    code: "unsupported_agent_message",
    message: "Unsupported Agent WebSocket message.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

function handleAgentWorkMessage(message: AgentClientMessage, ws: WSContext): void {
  if (!getUsableAgentLlmConfig()) {
    sendError(ws, {
      code: "missing_agent_config",
      message: "Configure an Agent LLM before using the Agent.",
      requestId: message.requestId,
      runId: message.runId,
      recoverable: true
    });
    return;
  }

  sendError(ws, {
    code: "agent_work_unavailable",
    message: "Agent planning and execution are not available in this build yet.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

function cancelActiveRun(
  session: AgentSocketSession,
  reason: string,
  requestedRunId?: string
): { runId?: string; alreadyCancelled: boolean; reason: string } {
  const activeRun = session.activeRun;
  if (!activeRun || (requestedRunId && requestedRunId !== activeRun.id)) {
    return {
      runId: requestedRunId ?? activeRun?.id,
      alreadyCancelled: true,
      reason
    };
  }

  const alreadyCancelled = activeRun.cancelled;
  if (!activeRun.cancelled) {
    activeRun.cancelled = true;
    activeRun.controller.abort(reason);
  }
  session.activeRun = undefined;

  return {
    runId: activeRun.id,
    alreadyCancelled,
    reason
  };
}

function parseAgentClientMessage(data: WSMessageReceive): ParsedMessage | MessageParseError {
  if (typeof data !== "string") {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: "Agent WebSocket messages must be JSON text."
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Agent WebSocket message must be valid JSON."
    };
  }

  if (!isRecord(value) || typeof value.type !== "string" || !isAgentClientMessageType(value.type)) {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: `Agent WebSocket message type must be one of: ${CLIENT_MESSAGE_TYPES.join(", ")}.`
    };
  }

  if (value.requestId !== undefined && typeof value.requestId !== "string") {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: "Agent WebSocket requestId must be a string when provided."
    };
  }

  if (value.runId !== undefined && typeof value.runId !== "string") {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: "Agent WebSocket runId must be a string when provided."
    };
  }

  return {
    ok: true,
    value: value as unknown as AgentClientMessage
  };
}

function sendError(
  ws: WSContext,
  input: Omit<AgentErrorEvent, "type" | "timestamp">
): void {
  sendEvent(ws, {
    type: "error",
    timestamp: new Date().toISOString(),
    ...input
  });
}

function sendEvent(ws: WSContext, event: AgentServerEvent): void {
  if (ws.readyState !== OPEN_READY_STATE) {
    return;
  }

  ws.send(JSON.stringify(event));
}

function isAgentClientMessageType(value: string): value is AgentClientMessageType {
  return (CLIENT_MESSAGE_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

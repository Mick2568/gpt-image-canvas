import { randomUUID } from "node:crypto";
import type { WSEvents, WSContext, WSMessageReceive } from "hono/ws";
import type {
  AgentClientMessage,
  AgentClientMessageType,
  AgentErrorEvent,
  AgentServerEvent,
  GenerationPlan
} from "./contracts.js";
import { getUsableAgentLlmConfig } from "./agent-config.js";
import {
  executeGenerationPlan,
  isExecutableGenerationPlan,
  type StoredAgentGenerationPlan
} from "./agent-executor.js";
import { createGenerationPlan } from "./agent-planner.js";

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
  plans: Map<string, StoredAgentGenerationPlan>;
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
    connectionId: randomUUID(),
    plans: new Map()
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
    handleAgentWorkMessage(message, ws, session);
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

function handleAgentWorkMessage(message: AgentClientMessage, ws: WSContext, session: AgentSocketSession): void {
  const llmConfig = getUsableAgentLlmConfig();
  if (!llmConfig) {
    sendError(ws, {
      code: "missing_agent_config",
      message: "Configure an Agent LLM before using the Agent.",
      requestId: message.requestId,
      runId: message.runId,
      recoverable: true
    });
    return;
  }

  if (message.type === "user_message") {
    if (session.activeRun) {
      sendError(ws, {
        code: "agent_run_in_progress",
        message: "An Agent run is already in progress for this connection.",
        requestId: message.requestId,
        runId: session.activeRun.id,
        recoverable: true
      });
      return;
    }

    const runId = message.runId ?? randomUUID();
    const activeRun: ActiveAgentRun = {
      id: runId,
      controller: new AbortController(),
      cancelled: false
    };
    session.activeRun = activeRun;
    void handleAgentPlanMessage(message, ws, session, activeRun, llmConfig);
    return;
  }

  if (message.type === "execute_plan" || message.type === "retry_failed") {
    if (session.activeRun) {
      sendError(ws, {
        code: "agent_run_in_progress",
        message: "An Agent run is already in progress for this connection.",
        requestId: message.requestId,
        runId: session.activeRun.id,
        recoverable: true
      });
      return;
    }

    const storedPlan = resolveStoredPlanForExecution(session, message);
    if (!storedPlan) {
      sendError(ws, {
        code: "unknown_agent_plan",
        message: "The requested Agent plan is not available. Regenerate the plan or execute it from the canvas node payload.",
        requestId: message.requestId,
        runId: message.runId,
        recoverable: true
      });
      return;
    }

    const runId = message.runId ?? randomUUID();
    const activeRun: ActiveAgentRun = {
      id: runId,
      controller: new AbortController(),
      cancelled: false
    };
    session.activeRun = activeRun;
    void handleAgentPlanExecutionMessage(message, ws, session, activeRun, storedPlan);
    return;
  }

  sendError(ws, {
    code: "agent_work_unavailable",
    message: "This Agent action is not available in this build yet.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

async function handleAgentPlanMessage(
  message: Extract<AgentClientMessage, { type: "user_message" }>,
  ws: WSContext,
  session: AgentSocketSession,
  activeRun: ActiveAgentRun,
  llmConfig: NonNullable<ReturnType<typeof getUsableAgentLlmConfig>>
): Promise<void> {
  let result: Awaited<ReturnType<typeof createGenerationPlan>>;
  try {
    result = await createGenerationPlan({
      userText: message.text,
      defaults: message.defaults,
      selectedReferences: message.selectedReferences,
      llmConfig,
      onAssistantDelta: (delta) => {
        if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
          return;
        }

        sendEvent(ws, {
          type: "assistant_delta",
          requestId: message.requestId,
          runId: activeRun.id,
          delta,
          timestamp: new Date().toISOString()
        });
      },
      onThinkingDelta: (delta) => {
        if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
          return;
        }

        sendEvent(ws, {
          type: "assistant_thinking_delta",
          requestId: message.requestId,
          runId: activeRun.id,
          delta,
          timestamp: new Date().toISOString()
        });
      },
      signal: activeRun.controller.signal
    });
  } catch {
    result = {
      ok: false,
      code: "agent_planner_failed",
      message: "Agent planner request failed."
    };
  }

  if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
    return;
  }

  session.activeRun = undefined;

  if (!result.ok) {
    sendError(ws, {
      code: result.code,
      message: result.message,
      requestId: message.requestId,
      runId: activeRun.id,
      recoverable: true
    });
    sendEvent(ws, {
      type: "run_done",
      requestId: message.requestId,
      runId: activeRun.id,
      status: "failed",
      timestamp: new Date().toISOString()
    });
    return;
  }

  session.plans.set(result.plan.id, {
    plan: result.plan,
    selectedReferences: message.selectedReferences ?? []
  });

  sendEvent(ws, {
    type: "plan_created",
    requestId: message.requestId,
    runId: activeRun.id,
    plan: result.plan,
    timestamp: new Date().toISOString()
  });
  sendEvent(ws, {
    type: "run_done",
    requestId: message.requestId,
    runId: activeRun.id,
    status: "succeeded",
    timestamp: new Date().toISOString()
  });
}

async function handleAgentPlanExecutionMessage(
  message: Extract<AgentClientMessage, { type: "execute_plan" | "retry_failed" }>,
  ws: WSContext,
  session: AgentSocketSession,
  activeRun: ActiveAgentRun,
  storedPlan: StoredAgentGenerationPlan
): Promise<void> {
  let result: Awaited<ReturnType<typeof executeGenerationPlan>>;
  try {
    result = await executeGenerationPlan({
      ...storedPlan,
      mode: message.type === "execute_plan" ? "execute" : "retry_failed",
      requestId: message.requestId,
      runId: activeRun.id,
      signal: activeRun.controller.signal,
      isRunActive: () => session.activeRun?.id === activeRun.id && !activeRun.cancelled,
      sendEvent: (event) => sendEvent(ws, event)
    });
  } catch (error) {
    if (activeRun.controller.signal.aborted || activeRun.cancelled || session.activeRun?.id !== activeRun.id) {
      return;
    }

    const messageText = error instanceof Error && error.message ? error.message : "Agent plan execution failed.";
    sendError(ws, {
      code: "agent_execution_failed",
      message: messageText,
      requestId: message.requestId,
      runId: activeRun.id,
      recoverable: true
    });
    sendEvent(ws, {
      type: "run_done",
      requestId: message.requestId,
      runId: activeRun.id,
      status: "failed",
      timestamp: new Date().toISOString()
    });
    session.activeRun = undefined;
    return;
  }

  if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
    return;
  }

  session.activeRun = undefined;
  session.plans.set(result.plan.id, {
    plan: result.plan,
    selectedReferences: storedPlan.selectedReferences
  });
  sendEvent(ws, {
    type: "run_done",
    requestId: message.requestId,
    runId: activeRun.id,
    status: result.status,
    timestamp: new Date().toISOString()
  });
}

function resolveStoredPlanForExecution(
  session: AgentSocketSession,
  message: Extract<AgentClientMessage, { type: "execute_plan" | "retry_failed" }>
): StoredAgentGenerationPlan | undefined {
  const messagePlan = isExecutableGenerationPlan(message.plan) && message.plan.id === message.planId ? message.plan : undefined;
  const storedPlan = session.plans.get(message.planId);

  if (!messagePlan) {
    return storedPlan;
  }

  return {
    plan: messagePlan,
    selectedReferences: storedPlan?.selectedReferences ?? selectedReferencesFromPlan(messagePlan)
  };
}

function selectedReferencesFromPlan(plan: GenerationPlan): StoredAgentGenerationPlan["selectedReferences"] {
  const selectedReferences = new Map<string, StoredAgentGenerationPlan["selectedReferences"][number]>();
  for (const job of plan.jobs) {
    for (const reference of job.references) {
      if (reference.kind !== "selected_canvas_image" || !reference.assetId) {
        continue;
      }
      selectedReferences.set(reference.assetId, {
        id: reference.assetId,
        assetId: reference.assetId,
        label: reference.label
      });
    }
  }

  return [...selectedReferences.values()];
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

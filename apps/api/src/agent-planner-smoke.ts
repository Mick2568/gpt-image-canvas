import {
  agentModelKwargsForConfig,
  buildPlannerUserMessage,
  createDirectChatPlanner,
  createGenerationPlan,
  extractReasoningFromAgentResult,
  parseGenerationPlanModelOutput,
  type AgentPlannerResult,
  validateGenerationPlan
} from "./agent-planner.js";
import type { UsableAgentLlmConfig } from "./agent-config.js";
import type {
  AgentSelectedCanvasReference,
  GenerationPlanDefaults,
  GenerationPlanValidationResult
} from "./contracts.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const defaults: GenerationPlanDefaults = {
  size: {
    width: 1024,
    height: 1024
  },
  quality: "auto",
  outputFormat: "png",
  count: 1
};
const selectedReferences: AgentSelectedCanvasReference[] = [
  {
    id: "shape-ref-1",
    assetId: "asset-ref-1",
    label: "Selected product image",
    width: 1024,
    height: 1024,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AAAA"
  }
];

async function main(): Promise<void> {
  smokeValidSimplePlan();
  smokeMultiPromptPlan();
  smokeSelectedReferencePlan();
  smokeGeneratedAnchorDependencyPlan();
  smokeOverLimitPlanRejection();
  smokeCyclePlanRejection();
  smokeInvalidJsonRejection();
  smokeNoVisionReferenceHandling();
  smokeDeepSeekPlannerKwargs();
  smokeReasoningExtraction();
  await smokeDirectPlannerStreamingSuccess();
  await smokeDirectPlannerCancellation();
  await smokeDirectPlannerInvalidJson();
  await smokeDirectPlannerTransportError();
  smokeModelJobSizeCoercion();
  smokeModelReferenceAliases();

  console.log("agent planner smoke checks passed");
}

function smokeValidSimplePlan(): void {
  const result = validate(planFixture(), []);
  expectOk(result, "valid simple plan");
  expect(result.plan.jobs.length === 1, "simple plan has one job");
  expect(result.plan.jobs[0]?.count === 1, "simple plan count is one");
}

function smokeMultiPromptPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({ id: "hero_square", prompt: "Create a square hero product render.", count: 2 }),
        jobFixture({ id: "detail_square", prompt: "Create a close-up detail render.", count: 2 })
      ]
    }),
    []
  );
  expectOk(result, "multi-prompt plan");
  expect(result.plan.jobs.length === 2, "multi-prompt plan has two jobs");
}

function smokeSelectedReferencePlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected_canvas_image",
              usage: "product",
              assetId: "asset-ref-1"
            }
          ]
        })
      ]
    }),
    selectedReferences
  );
  expectOk(result, "selected-reference plan");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "selected reference is preserved");
}

function smokeGeneratedAnchorDependencyPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "character_anchor",
          role: "character_anchor",
          prompt: "Create one visible character anchor for a young explorer.",
          count: 1
        }),
        jobFixture({
          id: "story_scene",
          prompt: "Create two story scenes using the character anchor.",
          count: 2,
          references: [
            {
              kind: "generated_output",
              usage: "character",
              jobId: "character_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "character_anchor",
          toJobId: "story_scene"
        }
      ]
    }),
    []
  );
  expectOk(result, "generated-anchor dependency plan");
  expect(result.plan.edges.length === 1, "anchor plan has dependency edge");
}

function smokeOverLimitPlanRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({ id: "batch_a", count: 16 }),
        jobFixture({ id: "batch_b", count: 1 })
      ]
    }),
    []
  );
  expect(!result.ok, "over-limit plan is rejected");
  expect(result.code === "generation_plan_limit_exceeded", "over-limit rejection code is stable");
}

function smokeCyclePlanRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "source_a",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "source_b"
            }
          ]
        }),
        jobFixture({
          id: "source_b",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "source_a"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "source_a",
          toJobId: "source_b"
        },
        {
          fromJobId: "source_b",
          toJobId: "source_a"
        }
      ]
    }),
    []
  );
  expect(!result.ok, "cycle plan is rejected");
  expect(result.code === "generation_dependency_cycle", "cycle rejection code is stable");
}

function smokeInvalidJsonRejection(): void {
  const result = parseGenerationPlanModelOutput("Here is the plan: {}", {
    defaults,
    selectedReferences: [],
    now
  });
  expect(!result.ok, "non-JSON model output is rejected");
  expect(result.code === "invalid_plan_json", "non-JSON rejection code is stable");
}

function smokeNoVisionReferenceHandling(): void {
  const message = buildPlannerUserMessage({
    userText: "Use my selected image as a product reference.",
    defaults,
    selectedReferences,
    supportsVision: false
  });

  expect(typeof message.content === "string", "no-vision planner message is text-only");
  expect(!message.content.includes("data:image"), "no-vision planner message does not include image data");
  expect(message.content.includes("Do not claim visual inspection"), "no-vision message includes inspection warning");
}

function smokeDeepSeekPlannerKwargs(): void {
  const kwargs = agentModelKwargsForConfig({
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro"
  });

  expect(isRecord(kwargs.thinking), "DeepSeek planner enables thinking");
  expect(kwargs.reasoning_effort === "high", "DeepSeek planner sets high reasoning effort");

  const openAIKwargs = agentModelKwargsForConfig({
    model: "gpt-4.1-mini"
  });
  expect(Object.keys(openAIKwargs).length === 0, "OpenAI planner kwargs are unchanged");
}

function smokeReasoningExtraction(): void {
  const reasoning = extractReasoningFromAgentResult({
    messages: [
      {
        content: "ordinary assistant text",
        additional_kwargs: {
          reasoning_content: "I should split the request into four scenes."
        }
      }
    ]
  });

  expect(reasoning === "I should split the request into four scenes.", "reasoning content is extracted");
}

async function smokeDirectPlannerStreamingSuccess(): Promise<void> {
  const assistantDeltas: string[] = [];
  const thinkingDeltas: string[] = [];
  const planJson = JSON.stringify(
    planFixture({
      id: "streamed-plan",
      jobs: [
        jobFixture({
          id: "streamed-final",
          prompt: "Create one polished hero image with soft lighting."
        })
      ]
    })
  );
  const splitAt = Math.floor(planJson.length / 2);
  const result = await createGenerationPlan({
    userText: "Create a polished hero image.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: createDirectChatPlanner(
      streamingModel([
        {
          reasoning_content: "I should turn the request into one final image."
        },
        {
          content: planJson.slice(0, splitAt)
        },
        {
          additional_kwargs: {
            reasoning: {
              text: "Defaults fit the requested square render."
            }
          }
        },
        {
          content: [
            {
              type: "text",
              text: planJson.slice(splitAt)
            }
          ]
        },
        {
          response_metadata: {
            reasoning_content: "The plan JSON is complete."
          }
        }
      ])
    ),
    onAssistantDelta: (delta) => assistantDeltas.push(delta),
    onThinkingDelta: (delta) => thinkingDeltas.push(delta)
  });

  expectPlannerOk(result, "streamed direct planner");
  expect(result.plan.id === "streamed-plan", "streamed planner returns the validated plan");
  expect(result.plan.jobs[0]?.id === "streamed-final", "streamed planner parses final content chunks");
  expect(thinkingDeltas.length === 3, "streamed planner emits reasoning deltas from chunk fields");
  expect(
    thinkingDeltas.includes("I should turn the request into one final image."),
    "top-level reasoning_content chunk is emitted"
  );
  expect(
    thinkingDeltas.includes("Defaults fit the requested square render."),
    "additional_kwargs reasoning chunk is emitted"
  );
  expect(thinkingDeltas.includes("The plan JSON is complete."), "response_metadata reasoning chunk is emitted");
  expect(assistantDeltas.length >= 2, "streamed planner emits human status before and after planning");
  expect(!assistantDeltas.join("").includes("schemaVersion"), "streamed planner does not emit raw JSON as assistant text");
}

async function smokeDirectPlannerCancellation(): Promise<void> {
  const controller = new AbortController();
  const thinkingDeltas: string[] = [];
  const planJson = JSON.stringify(planFixture({ id: "cancelled-streamed-plan" }));
  const result = await createGenerationPlan({
    userText: "Create one image, then cancel.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    signal: controller.signal,
    runner: createDirectChatPlanner(
      streamingModel([
        {
          reasoning_content: "Cancellation should stop before plan JSON is accepted."
        },
        {
          content: planJson
        }
      ])
    ),
    onThinkingDelta: (delta) => {
      thinkingDeltas.push(delta);
      controller.abort();
    }
  });

  expect(!result.ok, "cancelled streamed planner returns a failure");
  expect(result.code === "agent_run_cancelled", "cancelled streamed planner uses the cancellation code");
  expect(thinkingDeltas.length === 1, "cancelled streamed planner emitted the first reasoning chunk");
}

async function smokeDirectPlannerInvalidJson(): Promise<void> {
  const assistantDeltas: string[] = [];
  const result = await createGenerationPlan({
    userText: "Create one image with invalid streamed JSON.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: createDirectChatPlanner(
      streamingModel([
        {
          content: "not "
        },
        {
          content: "json"
        }
      ])
    ),
    onAssistantDelta: (delta) => assistantDeltas.push(delta)
  });

  expect(!result.ok, "invalid streamed JSON returns a failure");
  expect(result.code === "invalid_plan_json", "invalid streamed JSON uses the JSON error code");
  expect(!assistantDeltas.join("").includes("not json"), "invalid streamed JSON is not emitted as assistant text");
}

async function smokeDirectPlannerTransportError(): Promise<void> {
  const result = await createGenerationPlan({
    userText: "Create one image but the stream fails.",
    defaults,
    selectedReferences: [],
    llmConfig: llmConfigFixture(),
    now,
    runner: createDirectChatPlanner(
      failingStreamingModel(new Error("upstream failed for Bearer super.secret.token and sk-live-secret"))
    )
  });

  expect(!result.ok, "stream transport error returns a failure");
  expect(result.code === "agent_planner_failed", "stream transport error uses planner failed code");
  expect(!result.message.includes("super.secret.token"), "stream transport error redacts bearer token");
  expect(!result.message.includes("sk-live-secret"), "stream transport error redacts OpenAI-style key");
}

function smokeModelJobSizeCoercion(): void {
  const stringSizeResult = validate(
    planFixture({
      jobs: [jobFixture({ size: "1024x1024" })]
    }),
    []
  );
  expectOk(stringSizeResult, "string job size is accepted");
  expect(stringSizeResult.plan.jobs[0]?.size?.width === 1024, "string job size width is preserved");
  expect(stringSizeResult.plan.jobs[0]?.size?.height === 1024, "string job size height is preserved");

  const numericStringSizeResult = validate(
    planFixture({
      jobs: [jobFixture({ size: { width: "1024", height: "1024" } })]
    }),
    []
  );
  expectOk(numericStringSizeResult, "numeric string job size is accepted");
  expect(numericStringSizeResult.plan.jobs[0]?.size?.width === 1024, "numeric string job size width is preserved");

  const nullSizeResult = validate(
    planFixture({
      jobs: [jobFixture({ size: null })]
    }),
    []
  );
  expectOk(nullSizeResult, "null job size falls back to defaults");
  expect(nullSizeResult.plan.jobs[0]?.size === undefined, "null job size is omitted from the parsed job");
}

function smokeModelReferenceAliases(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "style_anchor",
          role: "style_anchor",
          prompt: "Create one visible picture book style anchor.",
          count: 1
        }),
        jobFixture({
          id: "page_1",
          references: [
            {
              type: "generated_output",
              usage: "style",
              sourceJobId: "style_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          from: "style_anchor",
          to: "page_1"
        }
      ]
    }),
    []
  );

  expectOk(result, "model reference aliases are accepted");
  expect(result.plan.jobs[1]?.references[0]?.kind === "generated_output", "reference type alias maps to kind");
  expect(result.plan.jobs[1]?.references[0]?.jobId === "style_anchor", "sourceJobId alias maps to jobId");
  expect(result.plan.edges[0]?.fromJobId === "style_anchor", "edge from alias maps to fromJobId");
  expect(result.plan.edges[0]?.toJobId === "page_1", "edge to alias maps to toJobId");
}

function validate(plan: Record<string, unknown>, references: AgentSelectedCanvasReference[]): GenerationPlanValidationResult {
  return validateGenerationPlan(plan, {
    defaults,
    selectedReferences: references,
    now,
    planId: "plan-test"
  });
}

function planFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "plan-draft",
    title: "Smoke plan",
    status: "awaiting_confirmation",
    defaults,
    jobs: [jobFixture()],
    edges: [],
    createdBy: "agent",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides
  };
}

function jobFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "final_image",
    role: "final_image",
    prompt: "Create one polished image.",
    count: 1,
    references: [],
    status: "queued",
    outputs: [],
    visible: true,
    ...overrides
  };
}

function expectOk(
  result: GenerationPlanValidationResult,
  label: string
): asserts result is Extract<GenerationPlanValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed validation: ${result.message}`);
  }
}

function expectPlannerOk(
  result: AgentPlannerResult,
  label: string
): asserts result is Extract<AgentPlannerResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed planning: ${result.message}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function llmConfigFixture(overrides: Partial<UsableAgentLlmConfig> = {}): UsableAgentLlmConfig {
  return {
    apiKey: "test-key",
    model: "deepseek-chat",
    timeoutMs: 60000,
    supportsVision: false,
    ...overrides
  };
}

function streamingModel(chunks: unknown[]): Parameters<typeof createDirectChatPlanner>[0] {
  return {
    async stream(_input: unknown, options?: { signal?: AbortSignal }) {
      return (async function* () {
        for (const chunk of chunks) {
          if (options?.signal?.aborted) {
            return;
          }
          yield chunk;
        }
      })();
    }
  } as unknown as Parameters<typeof createDirectChatPlanner>[0];
}

function failingStreamingModel(error: Error): Parameters<typeof createDirectChatPlanner>[0] {
  return {
    async stream() {
      return (async function* () {
        throw error;
      })();
    }
  } as unknown as Parameters<typeof createDirectChatPlanner>[0];
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

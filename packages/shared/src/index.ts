export const IMAGE_MODEL = "gpt-image-2" as const;

export type ImageModel = string;
export type ImageMode = "generate" | "edit";
export type ImageQuality = "auto" | "low" | "medium" | "high";
export type OutputFormat = "png" | "jpeg" | "webp";
export type GenerationStatus = "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type OutputStatus = "succeeded" | "failed";
export type CloudStorageProvider = "cos";
export type AssetCloudUploadStatus = "uploaded" | "failed";

export interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  description: string;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: "square-1k", label: "Square 1K", width: 1024, height: 1024, description: "Avatar and social image" },
  { id: "poster-portrait", label: "Portrait poster", width: 1024, height: 1536, description: "Poster, cover, and mobile vertical image" },
  { id: "poster-landscape", label: "Landscape poster", width: 1536, height: 1024, description: "Wide cover and desktop image" },
  { id: "story-9-16", label: "Story 9:16", width: 1088, height: 1920, description: "Short video cover and story image" },
  { id: "video-16-9", label: "Video 16:9", width: 1920, height: 1088, description: "Video cover and presentation image" },
  { id: "wide-2k", label: "Wide 2K", width: 2560, height: 1440, description: "Display page and wide composition" },
  { id: "portrait-2k", label: "Portrait 2K", width: 1440, height: 2560, description: "High-resolution portrait image" },
  { id: "square-2k", label: "Square 2K", width: 2048, height: 2048, description: "High-resolution square image" },
  { id: "wide-4k", label: "Wide 4K", width: 3840, height: 2160, description: "Large display image" }
];

export const STYLE_PRESETS = [
  {
    id: "none",
    label: "None",
    prompt: ""
  },
  {
    id: "photoreal",
    label: "Photoreal",
    prompt: "photorealistic, natural lighting, high detail, realistic materials"
  },
  {
    id: "product",
    label: "Product",
    prompt: "premium product photography, clean studio lighting, sharp focus, commercial composition"
  },
  {
    id: "illustration",
    label: "Illustration",
    prompt: "polished editorial illustration, clear shapes, rich but balanced colors, professional finish"
  },
  {
    id: "poster",
    label: "Poster",
    prompt: "bold poster composition, strong focal point, refined typography space, cinematic color grading"
  },
  {
    id: "avatar",
    label: "Avatar",
    prompt: "character portrait, expressive face, clean background, high quality avatar style"
  }
] as const;

export type StylePresetId = (typeof STYLE_PRESETS)[number]["id"];

export const IMAGE_QUALITIES: ImageQuality[] = ["auto", "low", "medium", "high"];
export const OUTPUT_FORMATS: OutputFormat[] = ["png", "jpeg", "webp"];
export const GENERATION_COUNTS = [1, 2, 4, 8, 16] as const;
export type GenerationCount = (typeof GENERATION_COUNTS)[number];

export interface ImageSize {
  width: number;
  height: number;
}

export type ResolutionTier = "1K" | "2K" | "4K";

export interface AssetMetadataResponse extends ImageSize {
  id: string;
}

export function resolutionTierForSize(size: ImageSize): ResolutionTier {
  const longestSide = Math.max(size.width, size.height);
  if (longestSide >= 3840) {
    return "4K";
  }
  if (longestSide >= 2048) {
    return "2K";
  }
  return "1K";
}

export const CUSTOM_SIZE_PRESET_ID = "custom" as const;
export type ImageSizePresetId = (typeof SIZE_PRESETS)[number]["id"] | typeof CUSTOM_SIZE_PRESET_ID;

export type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: ImageSizeValidationReason;
    };

export type ImageSizeValidationReason =
  | "non_integer"
  | "too_small"
  | "too_large"
  | "not_multiple"
  | "aspect_ratio"
  | "total_pixels_too_small"
  | "total_pixels_too_large"
  | "unsupported_preset";

export type ImageSizeValidationResult =
  | {
      ok: true;
      size: ImageSize;
      apiValue: string;
      source: "preset" | "custom";
      presetId?: ImageSizePresetId;
    }
  | {
      ok: false;
      code: "invalid_size" | "invalid_size_preset";
      message: string;
      reason?: ImageSizeValidationReason;
    };

export const MIN_IMAGE_DIMENSION = 512;
export const MAX_IMAGE_DIMENSION = 3840;
export const IMAGE_SIZE_MULTIPLE = 16;
export const MIN_TOTAL_PIXELS = 655_360;
export const MAX_TOTAL_PIXELS = 8_294_400;
export const MAX_IMAGE_ASPECT_RATIO = 3;

export function validateImageSize(size: ImageSize): ValidationResult {
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height)) {
    return { ok: false, code: "invalid_size", reason: "non_integer", message: "宽度和高度必须是整数。" };
  }
  if (size.width < MIN_IMAGE_DIMENSION || size.height < MIN_IMAGE_DIMENSION) {
    return { ok: false, code: "invalid_size", reason: "too_small", message: `宽度和高度不能小于 ${MIN_IMAGE_DIMENSION}px。` };
  }
  if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
    return { ok: false, code: "invalid_size", reason: "too_large", message: `宽度和高度不能大于 ${MAX_IMAGE_DIMENSION}px。` };
  }
  if (size.width % IMAGE_SIZE_MULTIPLE !== 0 || size.height % IMAGE_SIZE_MULTIPLE !== 0) {
    return { ok: false, code: "invalid_size", reason: "not_multiple", message: `宽度和高度必须是 ${IMAGE_SIZE_MULTIPLE}px 的倍数。` };
  }
  if (Math.max(size.width, size.height) / Math.min(size.width, size.height) > MAX_IMAGE_ASPECT_RATIO) {
    return { ok: false, code: "invalid_size", reason: "aspect_ratio", message: `长边和短边比例不能超过 ${MAX_IMAGE_ASPECT_RATIO}:1。` };
  }
  if (size.width * size.height < MIN_TOTAL_PIXELS) {
    return {
      ok: false,
      code: "invalid_size",
      reason: "total_pixels_too_small",
      message: `总像素不能小于 ${MIN_TOTAL_PIXELS.toLocaleString()}。`
    };
  }
  if (size.width * size.height > MAX_TOTAL_PIXELS) {
    return {
      ok: false,
      code: "invalid_size",
      reason: "total_pixels_too_large",
      message: `总像素不能超过 ${MAX_TOTAL_PIXELS.toLocaleString()}。`
    };
  }
  return { ok: true };
}

export function sizeToApiValue(size: ImageSize): string {
  return `${size.width}x${size.height}`;
}

export function validateSceneImageSize(input: {
  size: ImageSize;
  sizePresetId?: string | null;
}): ImageSizeValidationResult {
  const requestedPresetId = input.sizePresetId?.trim();
  const requestedPreset =
    requestedPresetId && requestedPresetId !== CUSTOM_SIZE_PRESET_ID
      ? SIZE_PRESETS.find((preset) => preset.id === requestedPresetId)
      : undefined;

  if (requestedPresetId && requestedPresetId !== CUSTOM_SIZE_PRESET_ID && !requestedPreset) {
    return {
      ok: false,
      code: "invalid_size_preset",
      reason: "unsupported_preset",
      message: "不支持的场景尺寸预设。"
    };
  }

  const sizeValidation = validateImageSize(input.size);
  if (!sizeValidation.ok) {
    return {
      ok: false,
      code: "invalid_size",
      reason: sizeValidation.reason,
      message: sizeValidation.message
    };
  }

  const matchingPreset = SIZE_PRESETS.find(
    (preset) => preset.width === input.size.width && preset.height === input.size.height
  );

  return {
    ok: true,
    size: input.size,
    apiValue: sizeToApiValue(input.size),
    source: matchingPreset ? "preset" : "custom",
    presetId: matchingPreset?.id ?? CUSTOM_SIZE_PRESET_ID
  };
}

export interface ReferenceImageInput {
  dataUrl: string;
  fileName?: string;
}

export const MAX_REFERENCE_IMAGES = 3;
export const GENERATION_PLAN_SCHEMA_VERSION = 1 as const;
export const MAX_GENERATION_PLAN_IMAGES = 16;
export const MAX_GENERATION_JOB_REFERENCES = MAX_REFERENCE_IMAGES;

export type GenerationPlanStatus =
  | "awaiting_confirmation"
  | "confirmed"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";

export type GenerationJobRole =
  | "final_image"
  | "variation"
  | "character_anchor"
  | "style_anchor"
  | "reference_anchor";

export type GenerationReferenceKind = "selected_canvas_image" | "generated_output";

export type GenerationReferenceUsage =
  | "subject"
  | "character"
  | "style"
  | "composition"
  | "scene"
  | "product"
  | "other";

export interface AgentSelectedCanvasReference {
  id: string;
  assetId: string;
  label?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  dataUrl?: string;
}

export interface GenerationPlanDefaults {
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count?: GenerationCount;
  stylePresetId?: StylePresetId;
}

export interface GenerationReference {
  kind: GenerationReferenceKind;
  usage: GenerationReferenceUsage;
  assetId?: string;
  jobId?: string;
  outputId?: string;
  label?: string;
}

export interface GenerationJob {
  id: string;
  role: GenerationJobRole;
  prompt: string;
  count: number;
  size?: ImageSize;
  quality?: ImageQuality;
  outputFormat?: OutputFormat;
  references: GenerationReference[];
  status: GenerationJobStatus;
  outputs: GenerationOutput[];
  visible: boolean;
  error?: string;
}

export interface GenerationDependencyEdge {
  fromJobId: string;
  toJobId: string;
}

export interface GenerationPlan {
  schemaVersion: typeof GENERATION_PLAN_SCHEMA_VERSION;
  id: string;
  title: string;
  status: GenerationPlanStatus;
  defaults: GenerationPlanDefaults;
  jobs: GenerationJob[];
  edges: GenerationDependencyEdge[];
  createdBy: "agent";
  createdAt: string;
  updatedAt: string;
}

export type GenerationPlanValidationCode =
  | "invalid_plan_json"
  | "invalid_plan_schema"
  | "invalid_plan_defaults"
  | "invalid_plan_job"
  | "invalid_plan_reference"
  | "invalid_plan_edge"
  | "generation_plan_limit_exceeded"
  | "generation_job_reference_limit_exceeded"
  | "unknown_generation_job_reference"
  | "generation_dependency_cycle"
  | "invalid_dependency_source_count";

export interface GenerationPlanValidationIssue {
  code: GenerationPlanValidationCode;
  message: string;
  path?: string;
}

export type GenerationPlanValidationResult =
  | {
      ok: true;
      plan: GenerationPlan;
    }
  | {
      ok: false;
      code: GenerationPlanValidationCode;
      message: string;
      issues: GenerationPlanValidationIssue[];
    };

export interface GenerateImageRequest {
  prompt: string;
  presetId: StylePresetId;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  outputCompression?: number;
  count: GenerationCount;
}

export interface EditImageRequest extends GenerateImageRequest {
  referenceImages: ReferenceImageInput[];
  referenceImage?: ReferenceImageInput;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}

export interface GeneratedAsset {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  cloud?: GeneratedAssetCloudInfo;
}

export interface GeneratedAssetCloudInfo {
  provider: CloudStorageProvider;
  status: AssetCloudUploadStatus;
  lastError?: string;
  uploadedAt?: string;
}

export interface GenerationOutput {
  id: string;
  status: OutputStatus;
  asset?: GeneratedAsset;
  error?: string;
}

export interface GenerationRecord {
  id: string;
  mode: ImageMode;
  prompt: string;
  effectivePrompt: string;
  presetId: string;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: number;
  status: GenerationStatus;
  error?: string;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
  createdAt: string;
  outputs: GenerationOutput[];
}

export interface GenerationResponse {
  record: GenerationRecord;
}

export interface GalleryImageItem {
  outputId: string;
  generationId: string;
  mode: ImageMode;
  prompt: string;
  effectivePrompt: string;
  presetId: string;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  createdAt: string;
  asset: GeneratedAsset;
}

export interface GalleryResponse {
  items: GalleryImageItem[];
}

export interface ProjectState {
  id: string;
  name: string;
  snapshot: unknown | null;
  history: GenerationRecord[];
  updatedAt: string;
}

export interface AppConfig {
  model: ImageModel;
  models: ImageModel[];
  sizePresets: SizePreset[];
  stylePresets: typeof STYLE_PRESETS;
  qualities: ImageQuality[];
  outputFormats: OutputFormat[];
  counts: readonly GenerationCount[];
}

export type RuntimeImageProvider = "openai" | "codex" | "none";

export const PROVIDER_SOURCE_IDS = ["env-openai", "local-openai", "codex"] as const;
export type ProviderSourceId = (typeof PROVIDER_SOURCE_IDS)[number];
export type ProviderSourceKind = "environment" | "local" | "codex";
export type ProviderSourceStatus = "available" | "missing_api_key" | "missing_codex_session";

export interface MaskedSecret {
  hasSecret: boolean;
  value?: string;
}

export interface CodexAuthSessionView {
  available: boolean;
  email?: string;
  accountId?: string;
  expiresAt?: string;
  refreshedAt?: string;
  unavailableReason?: string;
}

export interface ProviderSourceDetails {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  codex?: CodexAuthSessionView;
}

export interface ProviderSourceView {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  available: boolean;
  status: ProviderSourceStatus;
  details: ProviderSourceDetails;
  secret: MaskedSecret;
}

export interface ProviderSourceSummary {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  provider: RuntimeImageProvider;
  available: boolean;
  status: ProviderSourceStatus;
}

export interface LocalOpenAIProviderConfigView {
  apiKey: MaskedSecret;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ProviderConfigResponse {
  sourceOrder: ProviderSourceId[];
  sources: ProviderSourceView[];
  localOpenAI: LocalOpenAIProviderConfigView;
  activeSource?: ProviderSourceSummary;
}

export interface SaveLocalOpenAIProviderConfig {
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface SaveProviderConfigRequest {
  sourceOrder: ProviderSourceId[];
  localOpenAI?: SaveLocalOpenAIProviderConfig;
}

export interface AgentLlmConfigView {
  configured: boolean;
  apiKey: MaskedSecret;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAgentLlmConfigRequest {
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
}

export type AgentClientMessageType =
  | "user_message"
  | "revise_plan"
  | "execute_plan"
  | "cancel_run"
  | "retry_failed"
  | "ping";

export interface AgentBaseClientMessage {
  type: AgentClientMessageType;
  requestId?: string;
  runId?: string;
}

export interface AgentPingClientMessage extends AgentBaseClientMessage {
  type: "ping";
}

export interface AgentCancelRunClientMessage extends AgentBaseClientMessage {
  type: "cancel_run";
}

export interface AgentUserMessageClientMessage extends AgentBaseClientMessage {
  type: "user_message";
  text: string;
  selectedReferences?: AgentSelectedCanvasReference[];
  selectedReferenceIds?: string[];
  defaults?: Record<string, unknown>;
}

export interface AgentRevisePlanClientMessage extends AgentBaseClientMessage {
  type: "revise_plan";
  planId: string;
  instructions: string;
}

export interface AgentExecutePlanClientMessage extends AgentBaseClientMessage {
  type: "execute_plan";
  planId: string;
  plan?: GenerationPlan;
}

export interface AgentRetryFailedClientMessage extends AgentBaseClientMessage {
  type: "retry_failed";
  planId: string;
  plan?: GenerationPlan;
}

export type AgentClientMessage =
  | AgentPingClientMessage
  | AgentCancelRunClientMessage
  | AgentUserMessageClientMessage
  | AgentRevisePlanClientMessage
  | AgentExecutePlanClientMessage
  | AgentRetryFailedClientMessage;

export type AgentServerEventType =
  | "connected"
  | "assistant_delta"
  | "assistant_thinking_delta"
  | "plan_created"
  | "plan_updated"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_blocked"
  | "asset_preview"
  | "run_cancelled"
  | "run_done"
  | "error"
  | "pong";

export interface AgentBaseServerEvent {
  type: AgentServerEventType;
  requestId?: string;
  runId?: string;
  timestamp: string;
}

export interface AgentConnectedEvent extends AgentBaseServerEvent {
  type: "connected";
  connectionId: string;
}

export interface AgentPongEvent extends AgentBaseServerEvent {
  type: "pong";
}

export interface AgentErrorEvent extends AgentBaseServerEvent {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
}

export interface AgentAssistantDeltaEvent extends AgentBaseServerEvent {
  type: "assistant_delta";
  delta: string;
}

export interface AgentAssistantThinkingDeltaEvent extends AgentBaseServerEvent {
  type: "assistant_thinking_delta";
  delta: string;
}

export interface AgentPlanCreatedEvent extends AgentBaseServerEvent {
  type: "plan_created";
  plan: GenerationPlan;
}

export interface AgentPlanUpdatedEvent extends AgentBaseServerEvent {
  type: "plan_updated";
  plan: GenerationPlan;
}

export interface AgentJobStartedEvent extends AgentBaseServerEvent {
  type: "job_started";
  planId: string;
  jobId: string;
}

export interface AgentJobCompletedEvent extends AgentBaseServerEvent {
  type: "job_completed";
  planId: string;
  jobId: string;
  outputs?: GenerationOutput[];
  record?: GenerationRecord;
}

export interface AgentJobFailedEvent extends AgentBaseServerEvent {
  type: "job_failed";
  planId: string;
  jobId: string;
  error: string;
}

export interface AgentJobBlockedEvent extends AgentBaseServerEvent {
  type: "job_blocked";
  planId: string;
  jobId: string;
  reason: string;
}

export interface AgentAssetPreviewEvent extends AgentBaseServerEvent {
  type: "asset_preview";
  planId: string;
  jobId: string;
  outputId: string;
  assetId: string;
  url: string;
  asset: GeneratedAsset;
  shapeId?: string;
}

export interface AgentRunCancelledEvent extends AgentBaseServerEvent {
  type: "run_cancelled";
  reason: string;
  alreadyCancelled: boolean;
}

export interface AgentRunDoneEvent extends AgentBaseServerEvent {
  type: "run_done";
  status: "succeeded" | "failed" | "cancelled";
}

export type AgentServerEvent =
  | AgentConnectedEvent
  | AgentPongEvent
  | AgentErrorEvent
  | AgentAssistantDeltaEvent
  | AgentAssistantThinkingDeltaEvent
  | AgentPlanCreatedEvent
  | AgentPlanUpdatedEvent
  | AgentJobStartedEvent
  | AgentJobCompletedEvent
  | AgentJobFailedEvent
  | AgentJobBlockedEvent
  | AgentAssetPreviewEvent
  | AgentRunCancelledEvent
  | AgentRunDoneEvent;

export interface AuthStatusResponse {
  provider: RuntimeImageProvider;
  openaiConfigured: boolean;
  codex: CodexAuthSessionView;
  activeSource?: ProviderSourceSummary;
}

export interface CodexDeviceStartResponse {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
  expiresAt: string;
}

export type CodexDevicePollStatus = "authorized" | "pending" | "expired" | "denied";

export interface CodexDevicePollResponse {
  status: CodexDevicePollStatus;
  auth?: AuthStatusResponse;
  interval?: number;
  message?: string;
}

export interface CodexLogoutResponse {
  ok: true;
  auth: AuthStatusResponse;
}

export interface CosStorageConfigView {
  secretId: string;
  secretKey: MaskedSecret;
  bucket: string;
  region: string;
  keyPrefix: string;
}

export interface StorageConfigResponse {
  enabled: boolean;
  provider: CloudStorageProvider;
  cos: CosStorageConfigView;
}

export interface SaveCosStorageConfig {
  secretId: string;
  secretKey?: string;
  preserveSecret?: boolean;
  bucket: string;
  region: string;
  keyPrefix: string;
}

export interface SaveStorageConfigRequest {
  enabled: boolean;
  provider: CloudStorageProvider;
  cos?: SaveCosStorageConfig;
}

export interface StorageTestResult {
  ok: boolean;
  message: string;
}

export function composePrompt(prompt: string, presetId: string): string {
  const trimmedPrompt = prompt.trim();
  const preset = STYLE_PRESETS.find((item) => item.id === presetId);
  if (!preset || preset.id === "none" || !preset.prompt) {
    return trimmedPrompt;
  }
  return `${trimmedPrompt}\n\nStyle direction: ${preset.prompt}`;
}

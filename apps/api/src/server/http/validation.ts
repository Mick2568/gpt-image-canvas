import {
  GENERATION_COUNTS,
  IMAGE_QUALITIES,
  MAX_REFERENCE_IMAGES,
  OUTPUT_FORMATS,
  PROVIDER_SOURCE_IDS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  composePrompt,
  validateSceneImageSize,
  type GenerationCount,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type ProviderSourceId,
  type ReferenceImageInput,
  type SaveAgentLlmConfigRequest,
  type SaveLocalOpenAIProviderConfig,
  type SaveProviderConfigRequest,
  type SaveStorageConfigRequest,
  type StylePresetId
} from "../../domain/contracts.js";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import { isProviderSourceOrder } from "../../domain/providers/provider-config.js";
import type { EditImageProviderInput, ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, type ErrorResponseBody, type ParseResult } from "./errors.js";

const MAX_PROJECT_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_CLIENT_REQUEST_ID_LENGTH = 120;

export interface ProjectPayload {
  name?: string;
  snapshotJson: string;
}

export function logProjectSaveRejected(error: ErrorResponseBody, request: Request): void {
  console.warn(
    `Project save rejected: ${error.error.code}. ${error.error.message}${formatRequestBodySummary(request)}`
  );
}

function formatRequestBodySummary(request: Request): string {
  const contentType = sanitizeHeaderValue(request.headers.get("content-type"));
  const contentLength = sanitizeHeaderValue(request.headers.get("content-length"));
  const transferEncoding = sanitizeHeaderValue(request.headers.get("transfer-encoding"));
  const bodySize = contentLength
    ? `content-length=${contentLength}`
    : transferEncoding
      ? `transfer-encoding=${transferEncoding}`
      : "content-length=unknown";

  return ` (${bodySize}, content-type=${contentType || "missing"})`;
}

function sanitizeHeaderValue(value: string | null): string {
  return (value ?? "").replace(/[\r\n]/gu, " ").trim().slice(0, 120);
}

export function parseGeneratePayload(input: unknown): ParseResult<ImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  return {
    ok: true,
    value: base.value
  };
}

export function parseCodexPollPayload(input: unknown): ParseResult<{ deviceAuthId: string; userCode: string }> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Codex 登入輪詢請求必須是 JSON 物件。")
    };
  }

  const deviceAuthId = parseOptionalString(input.deviceAuthId);
  const userCode = parseOptionalString(input.userCode);

  if (!deviceAuthId || !userCode) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Codex 登入輪詢缺少裝置碼。")
    };
  }

  return {
    ok: true,
    value: {
      deviceAuthId,
      userCode
    }
  };
}

export function parseEditPayload(input: unknown): ParseResult<EditImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", "編輯圖片需要提供 1-3 張參考圖片。")
    };
  }

  const referenceImages = parseReferenceImages(input);
  if (!referenceImages.ok) {
    return referenceImages;
  }

  const referenceAssetIds = parseReferenceAssetIds(input, referenceImages.value.length);
  if (!referenceAssetIds.ok) {
    return referenceAssetIds;
  }

  for (const referenceAssetId of referenceAssetIds.value) {
    if (!getStoredAssetFile(referenceAssetId)) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "找不到可記錄的參考圖片資源。")
      };
    }
  }

  return {
    ok: true,
    value: {
      ...base.value,
      referenceImages: referenceImages.value,
      referenceImage: referenceImages.value[0],
      referenceAssetIds: referenceAssetIds.value.length > 0 ? referenceAssetIds.value : undefined,
      referenceAssetId: referenceAssetIds.value[0]
    }
  };
}

function parseReferenceImages(input: Record<string, unknown>): ParseResult<ReferenceImageInput[]> {
  const rawReferenceImages = Array.isArray(input.referenceImages)
    ? input.referenceImages
    : isRecord(input.referenceImage)
      ? [input.referenceImage]
      : undefined;

  if (!rawReferenceImages) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", "編輯圖片需要提供 1-3 張參考圖片。")
    };
  }

  if (rawReferenceImages.length < 1 || rawReferenceImages.length > MAX_REFERENCE_IMAGES) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", `參考圖片數量必須是 1-${MAX_REFERENCE_IMAGES} 張。`)
    };
  }

  const referenceImages: ReferenceImageInput[] = [];
  for (const rawReferenceImage of rawReferenceImages) {
    if (!isRecord(rawReferenceImage)) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "參考圖片格式不受支援。")
      };
    }

    const dataUrl = rawReferenceImage.dataUrl;
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "參考圖片格式不受支援。")
      };
    }

    const fileName = rawReferenceImage.fileName;
    referenceImages.push({
      dataUrl,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim() : undefined
    });
  }

  return {
    ok: true,
    value: referenceImages
  };
}

function parseReferenceAssetIds(input: Record<string, unknown>, referenceImageCount: number): ParseResult<string[]> {
  const legacyReferenceAssetId = parseOptionalString(input.referenceAssetId);
  const rawReferenceAssetIds = Array.isArray(input.referenceAssetIds)
    ? input.referenceAssetIds
    : legacyReferenceAssetId
      ? [legacyReferenceAssetId]
      : [];

  if (
    rawReferenceAssetIds.length > MAX_REFERENCE_IMAGES ||
    (rawReferenceAssetIds.length > 0 && rawReferenceAssetIds.length !== referenceImageCount)
  ) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "參考圖片資源 ID 數量必須與參考圖片數量一致。")
    };
  }

  const referenceAssetIds: string[] = [];
  for (const rawReferenceAssetId of rawReferenceAssetIds) {
    const referenceAssetId = parseOptionalString(rawReferenceAssetId);
    if (!referenceAssetId) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "參考圖片資源 ID 格式不受支援。")
      };
    }

    referenceAssetIds.push(referenceAssetId);
  }

  return {
    ok: true,
    value: referenceAssetIds
  };
}

export function parseStorageConfigPayload(input: unknown): ParseResult<SaveStorageConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_storage_config", "Storage config payload must be a JSON object.")
    };
  }

  const provider = parseOptionalString(input.provider) ?? "cos";
  if (provider !== "cos" && provider !== "s3") {
    return {
      ok: false,
      error: errorResponse("invalid_storage_provider", "Only Tencent COS and S3-compatible storage are supported.")
    };
  }

  const enabled = input.enabled === true;
  if (!enabled) {
    return {
      ok: true,
      value: {
        enabled: false,
        provider
      }
    };
  }

  if (provider === "cos" && !isRecord(input.cos)) {
    return {
      ok: false,
      error: errorResponse("invalid_storage_config", "COS config must be a JSON object.")
    };
  }

  const s3Config = input.s3;
  if (provider === "s3" && !isRecord(s3Config)) {
    return {
      ok: false,
      error: errorResponse("invalid_storage_config", "S3-compatible config must be a JSON object.")
    };
  }

  if (provider === "s3" && isRecord(s3Config)) {
    const endpointMode = parseOptionalString(s3Config.endpointMode) === "custom" ? "custom" : "r2-account";
    return {
      ok: true,
      value: {
        enabled: true,
        provider: "s3",
        s3: {
          accessKeyId: stringValue(s3Config.accessKeyId) ?? "",
          secretAccessKey: stringValue(s3Config.secretAccessKey),
          preserveSecret: s3Config.preserveSecret === true,
          bucket: stringValue(s3Config.bucket) ?? "",
          region: stringValue(s3Config.region) ?? "",
          keyPrefix: stringValue(s3Config.keyPrefix) ?? "",
          endpointMode,
          accountId: stringValue(s3Config.accountId),
          endpoint: stringValue(s3Config.endpoint),
          forcePathStyle: s3Config.forcePathStyle === true
        }
      }
    };
  }

  const cosConfig = input.cos;
  if (!isRecord(cosConfig)) {
    return {
      ok: false,
      error: errorResponse("invalid_storage_config", "COS config must be a JSON object.")
    };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      provider: "cos",
      cos: {
        secretId: stringValue(cosConfig.secretId) ?? "",
        secretKey: stringValue(cosConfig.secretKey),
        preserveSecret: cosConfig.preserveSecret === true,
        bucket: stringValue(cosConfig.bucket) ?? "",
        region: stringValue(cosConfig.region) ?? "",
        keyPrefix: stringValue(cosConfig.keyPrefix) ?? ""
      }
    }
  };
}

export function parseAgentLlmConfigPayload(input: unknown): ParseResult<SaveAgentLlmConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM config payload must be a JSON object.")
    };
  }

  if (Object.hasOwn(input, "apiKey") && typeof input.apiKey !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM API key must be a string.")
    };
  }

  if (typeof input.baseUrl !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM base URL must be a string.")
    };
  }

  if (typeof input.model !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM model must be a string.")
    };
  }

  if (typeof input.timeoutMs !== "number" || !Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM timeout must be a positive integer.")
    };
  }

  if (typeof input.supportsVision !== "boolean") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM supportsVision must be a boolean.")
    };
  }

  return {
    ok: true,
    value: {
      apiKey: stringValue(input.apiKey),
      preserveApiKey: input.preserveApiKey === true,
      baseUrl: input.baseUrl,
      model: input.model,
      timeoutMs: input.timeoutMs,
      supportsVision: input.supportsVision
    }
  };
}

export function parseProviderConfigPayload(input: unknown): ParseResult<SaveProviderConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Provider config payload must be a JSON object.")
    };
  }

  const sourceOrder = parseProviderSourceOrderPayload(input.sourceOrder);
  if (!sourceOrder.ok) {
    return sourceOrder;
  }

  if (input.localOpenAI === undefined) {
    return {
      ok: true,
      value: {
        sourceOrder: sourceOrder.value
      }
    };
  }

  const localOpenAI = parseLocalOpenAIProviderConfig(input.localOpenAI);
  if (!localOpenAI.ok) {
    return localOpenAI;
  }

  return {
    ok: true,
    value: {
      sourceOrder: sourceOrder.value,
      localOpenAI: localOpenAI.value
    }
  };
}

function parseProviderSourceOrderPayload(input: unknown): ParseResult<ProviderSourceId[]> {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_source_order", "Provider source order must be an array.")
    };
  }

  if (!isProviderSourceOrder(input)) {
    return {
      ok: false,
      error: errorResponse(
        "invalid_provider_source_order",
        `Provider source order must contain each supported source exactly once: ${PROVIDER_SOURCE_IDS.join(", ")}.`
      )
    };
  }

  return {
    ok: true,
    value: [...input]
  };
}

function parseLocalOpenAIProviderConfig(input: unknown): ParseResult<SaveLocalOpenAIProviderConfig> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Custom OpenAI config must be a JSON object.")
    };
  }

  const config: SaveLocalOpenAIProviderConfig = {
    preserveApiKey: input.preserveApiKey === true
  };

  if (Object.hasOwn(input, "apiKey")) {
    if (typeof input.apiKey !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI API key must be a string.")
      };
    }
    config.apiKey = input.apiKey;
  }

  if (Object.hasOwn(input, "baseUrl")) {
    if (typeof input.baseUrl !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI base URL must be a string.")
      };
    }
    config.baseUrl = input.baseUrl;
  }

  if (Object.hasOwn(input, "model")) {
    if (typeof input.model !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI model must be a string.")
      };
    }
    config.model = input.model;
  }

  if (Object.hasOwn(input, "timeoutMs")) {
    const timeoutMs = parsePositiveIntegerValue(input.timeoutMs);
    if (!timeoutMs) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI timeout must be a positive integer.")
      };
    }
    config.timeoutMs = timeoutMs;
  }

  return {
    ok: true,
    value: config
  };
}

function parseBaseImagePayload(input: unknown): ParseResult<ImageProviderInput> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "請求內容必須是 JSON 物件。")
    };
  }

  const prompt = input.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "請輸入有效的提示詞。")
    };
  }

  const stylePreset = parseStylePreset(input);
  if (!stylePreset.ok) {
    return stylePreset;
  }

  const size = parseSize(input.size);
  if (!size.ok) {
    return size;
  }

  const sizePresetId = parseOptionalString(input.sizePresetId) ?? parseOptionalString(input.scenePresetId) ?? parseSizePresetFromPresetId(input.presetId);
  const resolvedSize = validateSceneImageSize({
    size: size.value,
    sizePresetId
  });

  if (!resolvedSize.ok) {
    return {
      ok: false,
      error: errorResponse(resolvedSize.code, resolvedSize.message)
    };
  }

  const quality = parseQuality(input.quality);
  if (!quality.ok) {
    return quality;
  }

  const outputFormat = parseOutputFormat(input.outputFormat);
  if (!outputFormat.ok) {
    return outputFormat;
  }

  const count = parseCount(input.count);
  if (!count.ok) {
    return count;
  }

  const clientRequestId = parseClientRequestId(input.clientRequestId);
  if (!clientRequestId.ok) {
    return clientRequestId;
  }

  return {
    ok: true,
    value: {
      originalPrompt: prompt.trim(),
      clientRequestId: clientRequestId.value,
      presetId: stylePreset.value,
      prompt: composePrompt(prompt, stylePreset.value),
      size: resolvedSize.size,
      sizeApiValue: resolvedSize.apiValue,
      quality: quality.value,
      outputFormat: outputFormat.value,
      count: count.value
    }
  };
}

function parseClientRequestId(value: unknown): ParseResult<string | undefined> {
  if (value === undefined) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Client request ID must be a string.")
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (trimmed.length > MAX_CLIENT_REQUEST_ID_LENGTH || !/^[a-zA-Z0-9:_-]+$/u.test(trimmed)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Client request ID format is unsupported.")
    };
  }

  return {
    ok: true,
    value: trimmed
  };
}

function parseStylePreset(input: Record<string, unknown>): ParseResult<StylePresetId> {
  const presetId = parseOptionalString(input.stylePresetId) ?? parseStylePresetFromPresetId(input.presetId) ?? "none";

  if (!STYLE_PRESETS.some((preset) => preset.id === presetId)) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "不支援的風格預設。")
    };
  }

  return {
    ok: true,
    value: presetId as StylePresetId
  };
}

function parseSize(value: unknown): ParseResult<ImageSize> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: errorResponse("invalid_size", "請提供有效的圖片尺寸。")
    };
  }

  return {
    ok: true,
    value: {
      width: parseDimension(value.width),
      height: parseDimension(value.height)
    }
  };
}

function parseQuality(value: unknown): ParseResult<ImageQuality> {
  if (value === undefined) {
    return {
      ok: true,
      value: "auto"
    };
  }

  if (typeof value === "string" && IMAGE_QUALITIES.includes(value as ImageQuality)) {
    return {
      ok: true,
      value: value as ImageQuality
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "不支援的圖片品質設定。")
  };
}

function parseOutputFormat(value: unknown): ParseResult<OutputFormat> {
  if (value === undefined) {
    return {
      ok: true,
      value: "png"
    };
  }

  if (typeof value === "string" && OUTPUT_FORMATS.includes(value as OutputFormat)) {
    return {
      ok: true,
      value: value as OutputFormat
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "不支援的輸出格式。")
  };
}

function parseCount(value: unknown): ParseResult<GenerationCount> {
  if (value === undefined) {
    return {
      ok: true,
      value: 1
    };
  }

  if (typeof value === "number" && GENERATION_COUNTS.includes(value as GenerationCount)) {
    return {
      ok: true,
      value: value as GenerationCount
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "生成數量只能是 1、2、4、8 或 16。")
  };
}

function parseDimension(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function parsePositiveIntegerValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Request failed.";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseStylePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && STYLE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

function parseSizePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && SIZE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

export function parseProjectPayload(input: unknown):
  | {
      ok: true;
      value: ProjectPayload;
    }
  | {
      ok: false;
      error: { error: { code: string; message: string } };
    } {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_project", "Project payload must be a JSON object.")
    };
  }

  if (!Object.hasOwn(input, "snapshot")) {
    return {
      ok: false,
      error: errorResponse("missing_snapshot", "Project payload must include a snapshot.")
    };
  }

  const snapshot = input.snapshot;
  if (snapshot !== null && (!isRecord(snapshot) || Array.isArray(snapshot))) {
    return {
      ok: false,
      error: errorResponse("invalid_snapshot", "Project snapshot must be an object or null.")
    };
  }

  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = snapshotJson ? Buffer.byteLength(snapshotJson, "utf8") : 0;
  if (!snapshotJson || snapshotBytes > MAX_PROJECT_SNAPSHOT_BYTES) {
    return {
      ok: false,
      error: errorResponse(
        "invalid_snapshot",
        `Project snapshot is too large (${formatBytes(snapshotBytes)}). Maximum is ${formatBytes(MAX_PROJECT_SNAPSHOT_BYTES)}.`
      )
    };
  }

  const name = input.name;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_PROJECT_NAME_LENGTH) {
      return {
        ok: false,
        error: errorResponse("invalid_name", "Project name must be a non-empty string up to 120 characters.")
      };
    }

    return {
      ok: true,
      value: {
        name: name.trim(),
        snapshotJson
      }
    };
  }

  return {
    ok: true,
    value: {
      snapshotJson
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

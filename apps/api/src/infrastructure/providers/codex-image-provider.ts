import type { CodexAccessSession } from "../../domain/providers/codex-auth.js";
import type {
  EditImageProviderInput,
  ImageProvider,
  ImageProviderInput,
  ProviderResult
} from "./image-provider.js";
import { ProviderError, getConfiguredImageModel } from "./image-provider.js";
import type { ReferenceImageInput } from "../../domain/contracts.js";

const DEFAULT_CODEX_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_CODEX_RESPONSES_MODEL = "gpt-5.5";
const CODEX_IMAGE_INSTRUCTIONS =
  "Use the image_generation tool to create exactly one image for the user's request. Return the generated image result.";
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export interface CodexImageProviderConfig {
  baseURL: string;
  responsesModel: string;
  imageModel: string;
  timeoutMs: number;
  getSession: (signal?: AbortSignal) => Promise<CodexAccessSession | undefined>;
}

type ResponsesImageInput = ImageProviderInput | EditImageProviderInput;

interface ResponsesImageTool {
  type: "image_generation";
  model: string;
  action: "generate" | "edit";
  size: string;
  quality: string;
  output_format: string;
}

export interface CodexResponsesRequestBodyOptions {
  responsesModel?: string;
  imageModel?: string;
}

export function getCodexImageProviderTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.CODEX_IMAGE_TIMEOUT_MS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CODEX_IMAGE_TIMEOUT_MS;
}

export function getCodexResponsesModel(): string {
  return process.env.CODEX_RESPONSES_MODEL?.trim() || DEFAULT_CODEX_RESPONSES_MODEL;
}

export function createCodexImageProvider(config: CodexImageProviderConfig): ImageProvider {
  return new CodexResponsesImageProvider(config);
}

export function createCodexResponsesRequestBody(
  input: ResponsesImageInput,
  options: CodexResponsesRequestBodyOptions = {}
): Record<string, unknown> {
  const imageModel = options.imageModel ?? getConfiguredImageModel();
  const tool: ResponsesImageTool = {
    type: "image_generation",
    model: imageModel,
    action: "referenceImages" in input ? "edit" : "generate",
    size: input.sizeApiValue,
    quality: input.quality,
    output_format: input.outputFormat
  };

  return {
    model: options.responsesModel ?? getCodexResponsesModel(),
    instructions: CODEX_IMAGE_INSTRUCTIONS,
    store: false,
    input: [
      {
        role: "user",
        content: createResponsesInputContent(input)
      }
    ],
    tools: [tool],
    tool_choice: {
      type: "image_generation"
    },
    stream: true
  };
}

export function parseCodexResponsesEventsFromSse(text: string): unknown[] {
  const events: unknown[] = [];
  let dataLines: string[] = [];

  const flush = (): void => {
    if (dataLines.length === 0) {
      return;
    }

    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") {
      return;
    }

    try {
      events.push(JSON.parse(data) as unknown);
    } catch {
      events.push(data);
    }
  };

  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) {
      flush();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  flush();
  return events;
}

export function extractCodexImageBase64FromResponseEvents(events: unknown[]): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    for (const image of extractCodexImageBase64FromResponseEvent(event)) {
      if (!seen.has(image)) {
        seen.add(image);
        images.push(image);
      }
    }
  }

  return images;
}

export function extractCodexImageBase64FromResponseEvent(event: unknown): string[] {
  const record = objectValue(event);
  if (!record) {
    return [];
  }

  if (record.type === "response.output_item.done") {
    return extractImagesFromOutputItem(record.item ?? record.output_item);
  }

  if (record.type === "response.completed") {
    return extractImagesFromResponse(record.response);
  }

  return [...extractImagesFromResponse(record), ...extractImagesFromOutputItem(record)];
}

class CodexResponsesImageProvider implements ImageProvider {
  constructor(private readonly config: CodexImageProviderConfig) {}

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.requestImage(input, signal);
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.requestImage(input, signal);
  }

  private async requestImage(input: ResponsesImageInput, signal?: AbortSignal): Promise<ProviderResult> {
    const session = await this.config.getSession(signal);
    if (!session) {
      throw new ProviderError(
        "missing_provider",
        "伺服器沒有設定 OPENAI_API_KEY，也沒有可用的 Codex 登入工作階段。請先登入 Codex 後重試。",
        401
      );
    }

    const timeout = timeoutSignal(signal, this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseURL.replace(/\/+$/u, "")}/responses`, {
        method: "POST",
        headers: codexRequestHeaders(session),
        body: JSON.stringify(createCodexResponsesRequestBody(input, {
          responsesModel: this.config.responsesModel,
          imageModel: this.config.imageModel
        })),
        signal: timeout.signal
      }).catch((error: unknown) => {
        throw fetchFailureToProviderError(error);
      });

      if (!response.ok) {
        throw await codexHttpProviderErrorFromResponse(response);
      }

      const events = await readCodexResponseEvents(response);
      const images = extractCodexImageBase64FromResponseEvents(events);
      if (images.length === 0) {
        throw new ProviderError("unsupported_provider_behavior", "Codex 圖片服務沒有回傳圖片結果。", 502);
      }

      return {
        model: this.config.imageModel,
        size: input.sizeApiValue,
        images: images.map((image) => ({
          b64Json: image
        }))
      };
    } finally {
      timeout.cleanup();
    }
  }
}

async function readCodexResponseEvents(response: Response): Promise<unknown[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await response.json().catch(() => undefined);
    return json === undefined ? [] : [json];
  }

  return parseCodexResponsesEventsFromSse(await response.text());
}

function createResponsesInputContent(input: ResponsesImageInput): Array<Record<string, string>> {
  const content: Array<Record<string, string>> = [
    {
      type: "input_text",
      text: input.prompt
    }
  ];

  if ("referenceImages" in input) {
    for (const referenceImage of input.referenceImages) {
      content.push({
        type: "input_image",
        image_url: normalizeReferenceImageDataUrl(referenceImage)
      });
    }
  }

  return content;
}

function normalizeReferenceImageDataUrl(input: ReferenceImageInput): string {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "參考圖片格式不受支援。", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "參考圖片必須是 PNG、JPEG 或 WebP 格式。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "參考圖片不能超過 50MB。", 400);
  }

  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  return `data:${normalizedMimeType};base64,${match[2]}`;
}

function codexRequestHeaders(session: CodexAccessSession): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json"
  };

  if (session.accountId) {
    headers["ChatGPT-Account-ID"] = session.accountId;
  }

  return headers;
}

function extractImagesFromResponse(response: unknown): string[] {
  const record = objectValue(response);
  if (!record || !Array.isArray(record.output)) {
    return [];
  }

  return record.output.flatMap(extractImagesFromOutputItem);
}

function extractImagesFromOutputItem(item: unknown): string[] {
  const record = objectValue(item);
  if (!record || record.type !== "image_generation_call") {
    return [];
  }

  const image = normalizeImageBase64(record.result);
  return image ? [image] : [];
}

function normalizeImageBase64(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const dataUrlMatch = /^data:image\/[^;,]+;base64,(.+)$/u.exec(trimmed);
  return dataUrlMatch?.[1] ?? trimmed;
}

async function codexHttpProviderErrorFromResponse(response: Response): Promise<ProviderError> {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new ProviderError("upstream_failure", "Codex image service authentication failed. Please log in to Codex again.", status);
  }

  const detail = sanitizeCodexErrorDetail(await readCodexErrorDetail(response));
  const suffix = detail ? `: ${detail}` : "";
  return new ProviderError("upstream_failure", `Codex image service request failed (HTTP ${status})${suffix}`, providerHttpStatus(status));
}

async function readCodexErrorDetail(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined);
    return extractCodexErrorDetail(body);
  }

  return response.text().catch(() => undefined);
}

function extractCodexErrorDetail(value: unknown): string | undefined {
  const record = objectValue(value);
  if (!record) {
    return typeof value === "string" ? value : undefined;
  }

  const detail = record.detail ?? record.message;
  if (typeof detail === "string") {
    return detail;
  }

  const error = objectValue(record.error);
  return typeof error?.message === "string" ? error.message : undefined;
}

function sanitizeCodexErrorDetail(value: string | undefined): string | undefined {
  const sanitized = value
    ?.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);

  return sanitized || undefined;
}

function codexHttpProviderError(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("upstream_failure", "Codex 圖片服務認證失敗，請重新登入 Codex。", status);
  }

  return new ProviderError("upstream_failure", `Codex 圖片服務請求失敗（HTTP ${status}）。`, providerHttpStatus(status));
}

function fetchFailureToProviderError(error: unknown): ProviderError | Error {
  if (isAbortError(error)) {
    return new ProviderError("upstream_failure", "Codex 圖片服務請求逾時，請稍後重試或降低解析度。", 504);
  }

  return new ProviderError("upstream_failure", "Codex 圖片服務請求失敗，請稍後重試。", 502);
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function providerHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof DOMException && error.name === "AbortError";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

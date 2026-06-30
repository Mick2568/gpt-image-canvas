import { getCodexResponsesBaseURL, getValidCodexSession } from "./codex-auth.js";
import type { CodexAccessSession } from "./codex-auth.js";
import {
  createCodexImageProvider,
  getCodexImageProviderTimeoutMs,
  getCodexResponsesModel
} from "../../infrastructure/providers/codex-image-provider.js";
import {
  ProviderError,
  createOpenAIImageProvider,
  getConfiguredImageModel,
  type OpenAIImageProviderConfig,
  type ImageProvider
} from "../../infrastructure/providers/image-provider.js";
import {
  getEnvironmentOpenAIImageProviderConfig,
  getLocalOpenAIImageProviderConfig,
  getProviderSourceOrder
} from "./provider-config.js";
import type { ProviderSourceId, RuntimeImageProvider } from "../contracts.js";

export interface ConfiguredImageProviderSelection {
  sourceId: ProviderSourceId;
  provider: RuntimeImageProvider;
  openAIConfig?: OpenAIImageProviderConfig;
  codexSession?: CodexAccessSession;
}

export async function createConfiguredImageProvider(signal?: AbortSignal): Promise<ImageProvider> {
  const selection = await selectConfiguredImageProviderSource(signal);

  if (selection?.openAIConfig) {
    return createOpenAIImageProvider(selection.openAIConfig);
  }

  if (selection?.provider === "codex" && selection.codexSession) {
    return createCodexImageProvider({
      baseURL: getCodexResponsesBaseURL(),
      responsesModel: getCodexResponsesModel(),
      imageModel: getConfiguredImageModel(),
      timeoutMs: getCodexImageProviderTimeoutMs(),
      getSession: async (requestSignal?: AbortSignal) => selection.codexSession ?? getValidCodexSession(requestSignal)
    });
  }

  throw new ProviderError(
    "missing_provider",
    "伺服器沒有設定 OPENAI_API_KEY，也沒有可用的 Codex 登入工作階段。請先登入 Codex 後重試。",
    401
  );
}

export async function selectConfiguredImageProviderSource(
  signal?: AbortSignal
): Promise<ConfiguredImageProviderSelection | undefined> {
  for (const sourceId of getProviderSourceOrder()) {
    if (sourceId === "env-openai") {
      const openAIConfig = getEnvironmentOpenAIImageProviderConfig();
      if (openAIConfig) {
        return {
          sourceId,
          provider: "openai",
          openAIConfig
        };
      }
      continue;
    }

    if (sourceId === "local-openai") {
      const openAIConfig = getLocalOpenAIImageProviderConfig();
      if (openAIConfig) {
        return {
          sourceId,
          provider: "openai",
          openAIConfig
        };
      }
      continue;
    }

    const codexSession = await getValidCodexSession(signal);
    if (codexSession) {
      return {
        sourceId,
        provider: "codex",
        codexSession
      };
    }
  }

  return undefined;
}

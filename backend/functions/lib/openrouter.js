const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const FREE_MODEL_CACHE_MS = 60_000;

let cachedModels = null;
let cacheExpiresAt = 0;

export const NVIDIA_MODELS = [
  {
    id: "deepseek-ai/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    description: "Fast reasoning and coding for everyday tasks.",
    vision: false,
  },
  {
    id: "z-ai/glm-5.3-flash",
    name: "GLM-5.3 Flash",
    description: "Fast reasoning, coding, and image understanding.",
    vision: true,
  },
  {
    id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    name: "Nemotron Super VL",
    description: "Advanced reasoning and visual document understanding.",
    vision: true,
  },
  {
    id: "mistralai/mistral-large-4",
    name: "Mistral Large 4",
    description: "Advanced writing, reasoning, and multimodal assistance.",
    vision: true,
  },
  {
    id: "moonshotai/kimi-k3.1-pro",
    name: "Kimi K3.1 Pro",
    description: "Long-context analysis, coding, and visual understanding.",
    vision: true,
  },
  {
    id: "stepfun-ai/step-5-preview",
    name: "Step 5 Preview",
    description: "Preview reasoning model for complex problems and coding.",
    vision: false,
  },
  {
    id: "nvidia/nemotron-3.5-lightning-30b-a3b",
    name: "Nemotron Lightning",
    description: "Fast NVIDIA model for everyday chat and coding.",
    vision: false,
  },
].map((model) => ({ ...model, provider: "nvidia" }));

export async function getFreeModels({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedModels && Date.now() < cacheExpiresAt) return cachedModels;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(MODELS_ENDPOINT, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`OpenRouter model catalog returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.data)) {
      throw new Error("OpenRouter returned an invalid model catalog.");
    }

    cachedModels = payload.data
      .filter((model) => {
        const id = typeof model?.id === "string" ? model.id : "";
        const name = typeof model?.name === "string" ? model.name : "";
        const freeRoute = id === "openrouter/free" || id.endsWith(":free");
        return freeRoute
          && !/gemini/i.test(`${id} ${name}`)
          && Number(model?.pricing?.prompt) === 0
          && Number(model?.pricing?.completion) === 0;
      })
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        description: model.description || "",
        contextLength: Number.isFinite(model.context_length) ? model.context_length : null,
        vision: Array.isArray(model.architecture?.input_modalities)
          && model.architecture.input_modalities.includes("image"),
        provider: "openrouter",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cacheExpiresAt = Date.now() + FREE_MODEL_CACHE_MS;
    return cachedModels;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Timed out while loading the OpenRouter model catalog.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

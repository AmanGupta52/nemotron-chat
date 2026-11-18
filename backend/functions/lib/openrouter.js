const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const NVIDIA_MODELS_ENDPOINT = "https://integrate.api.nvidia.com/v1/models";
const FREE_MODEL_CACHE_MS = 60_000;
const NVIDIA_CACHE_MS = 10 * 60_000;
const MAX_EXTRA_NVIDIA_MODELS = 80;

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

// ---------------------------------------------------------------------------------------------
// NVIDIA catalog. The curated list above can contain ids that NVIDIA has renamed or retired
// (the API answers 404 / 410 for those). When an API key is configured we ask NVIDIA which models
// exist right now: curated models that are gone are hidden, and other chat-capable models that
// NVIDIA currently serves are appended after them. Without a key, or if NVIDIA is unreachable,
// the curated list is returned unchanged.
// ---------------------------------------------------------------------------------------------
const NON_CHAT = /embed|rerank|retriev|guard|safety|reward|parse|ocr|clip|asr|tts|riva|canary|parakeet|diffusion|flux|sdxl|cosmos|\bnv-|bge|e5-|paddle|yolo|segment|deplot|fuyu|kosmos|usdcode|genmol|molmim|diffdock|esm|alphafold|openfold|rfdiffusion|proteinmpnn|corrdiff|fourcastnet|maxine|studiovoice|audio2face|bevformer|sparsedrive|streampetr|vista|topic-control|jailbreak|nemoretriever/i;
const VISION = /-vl\b|-vl-|vision|multimodal|pixtral|llava|neva|vila|paligemma/i;

function prettyName(id) {
  return id.split("/").pop().replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

let nvidiaCache = null;
let nvidiaCacheExpiresAt = 0;

export async function getNvidiaModels({ forceRefresh = false } = {}) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return NVIDIA_MODELS;
  if (!forceRefresh && nvidiaCache && Date.now() < nvidiaCacheExpiresAt) return nvidiaCache;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(NVIDIA_MODELS_ENDPOINT, {
      signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`NVIDIA catalog returned HTTP ${response.status}.`);
    const payload = await response.json();
    const live = new Set((Array.isArray(payload?.data) ? payload.data : [])
      .map((model) => model?.id)
      .filter((id) => typeof id === "string" && id));
    if (!live.size) throw new Error("NVIDIA returned an empty model catalog.");

    const curated = NVIDIA_MODELS.filter((model) => live.has(model.id));
    const known = new Set(NVIDIA_MODELS.map((model) => model.id));
    const extras = [...live]
      .filter((id) => !known.has(id) && !NON_CHAT.test(id))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_EXTRA_NVIDIA_MODELS)
      .map((id) => ({
        id,
        name: prettyName(id),
        description: id.split("/")[0],
        vision: VISION.test(id),
        provider: "nvidia",
      }));

    nvidiaCache = [...curated, ...extras];
    nvidiaCacheExpiresAt = Date.now() + NVIDIA_CACHE_MS;
    return nvidiaCache;
  } catch {
    // Keep working with the static list; try again shortly.
    nvidiaCache = NVIDIA_MODELS;
    nvidiaCacheExpiresAt = Date.now() + 30_000;
    return nvidiaCache;
  } finally {
    clearTimeout(timeoutId);
  }
}

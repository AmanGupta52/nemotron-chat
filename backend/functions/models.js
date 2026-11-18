import { getFreeModels, NVIDIA_MODELS } from "./lib/openrouter.js";
import { withCors } from "./lib/security.js";

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

async function handler(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed. Use GET." }, 405);

  let openrouterModels = [];
  let openrouterError = "";
  try {
    const url = new URL(req.url);
    openrouterModels = await getFreeModels({ forceRefresh: url.searchParams.get("refresh") === "1" });
  } catch (error) {
    openrouterError = error?.message || "Model catalog request failed.";
  }

  return json({
    providers: {
      nvidia: {
        configured: Boolean(process.env.NVIDIA_API_KEY),
        models: NVIDIA_MODELS,
      },
      openrouter: {
        configured: Boolean(process.env.OPENROUTER_API_KEY),
        models: openrouterModels,
        error: openrouterError,
      },
    },
  });
}

export default withCors(handler);

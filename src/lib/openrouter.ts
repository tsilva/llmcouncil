export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
export const OPENROUTER_KEY_URL = `${OPENROUTER_BASE_URL}/key`;
export const OPENROUTER_FREE_MODEL = "openrouter/free";

export function missingOpenRouterKeyMessage(): string {
  return `No API key saved. Add a valid OpenRouter key to run debates. ${OPENROUTER_FREE_MODEL} can still be selected as a model, but this browser-based app cannot use OpenRouter without a key.`;
}

function resolveAppName(): string {
  return process.env.NEXT_PUBLIC_OPENROUTER_APP_NAME || "LLM Pit";
}

export function buildOpenRouterHeaders({
  apiKey,
  siteUrl,
}: {
  apiKey?: string;
  siteUrl?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-OpenRouter-Title": resolveAppName(),
  };

  const trimmedKey = apiKey?.trim();
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }

  if (siteUrl) {
    headers["HTTP-Referer"] = siteUrl;
  }

  return headers;
}

export function extractOpenRouterErrorMessage(text: string): string {
  let detail = text;

  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    detail = parsed.error?.message || parsed.message || text;
  } catch {
    // Keep the raw error body when it isn't JSON.
  }

  return detail.trim();
}

export async function validateOpenRouterKey(
  apiKey: string,
  siteUrl?: string,
): Promise<{ valid: boolean; message: string }> {
  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    return {
      valid: false,
      message: missingOpenRouterKeyMessage(),
    };
  }

  const response = await fetch(OPENROUTER_KEY_URL, {
    method: "GET",
    headers: buildOpenRouterHeaders({ apiKey: trimmedKey, siteUrl }),
  });

  if (response.ok) {
    return {
      valid: true,
      message: "OpenRouter API key verified. Selected models are enabled.",
    };
  }

  const text = await response.text();
  const detail = extractOpenRouterErrorMessage(text) || "OpenRouter rejected this API key.";

  return {
    valid: false,
    message: `${detail} Add a valid OpenRouter key to run debates.`,
  };
}

export function resolveOpenRouterModel(model: string, apiKey?: string): string {
  return apiKey?.trim() ? model : model;
}

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];
const REQUEST_TIMEOUT_MS = 20_000;
const BACKOFF_MS = 1000;

export type TextGenerator = (system: string, prompt: string) => Promise<string>;

export interface TextGeneratorOptions {
  apiKey: string;
  models?: string[];
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Writes banter. Tries each model once, because a late joke helps nobody and templates are always ready. */
export function createTextGenerator(options: TextGeneratorOptions): TextGenerator {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const models = options.models ?? DEFAULT_MODELS;

  return async (system, prompt) => {
    let lastError: unknown = new Error("No model configured.");
    for (const [index, model] of models.entries()) {
      if (index > 0) await sleep(BACKOFF_MS);
      try {
        const response = await fetchFn(`${API_URL}${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-goog-api-key": options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Gemini returned ${response.status}.`);

        const data = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
        if (!text) throw new Error("Gemini gave no answer.");
        return text;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Couldn't write text: ${String(lastError)}`);
  };
}

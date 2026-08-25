export type ModelResponse = {
  content: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ModelRequest = {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
};

export interface AiProvider {
  name: string;
  model: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  embed?(texts: string[]): Promise<number[][]>;
}

export class AiProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderUnavailableError";
  }
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

function ollamaProvider(): AiProvider {
  const model = process.env.OLLAMA_MODEL || "llama3.2";
  return {
    name: "ollama",
    model,
    async generate(request) {
      let response: Response;
      try {
        response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format: request.jsonSchema,
            keep_alive: "15m",
            options: { temperature: 0, num_ctx: 8_192, num_predict: 1_000, repeat_penalty: 1.15 },
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.prompt },
            ],
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "connection failed";
        throw new AiProviderUnavailableError(`Local Ollama is unavailable: ${message}`);
      }
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
      const payload = await response.json();
      return {
        content: String(payload.message?.content || ""),
        provider: "ollama",
        model,
        inputTokens: Number.isFinite(payload.prompt_eval_count) ? Number(payload.prompt_eval_count) : null,
        outputTokens: Number.isFinite(payload.eval_count) ? Number(payload.eval_count) : null,
      };
    },
    async embed(texts) {
      const embeddingModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
      const response = await fetch(`${ollamaBaseUrl()}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embeddingModel, input: texts, truncate: true }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Ollama embeddings returned ${response.status}.`);
      const payload = await response.json();
      if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length) {
        throw new Error("Ollama returned an invalid embedding response.");
      }
      return payload.embeddings as number[][];
    },
  };
}

function groqProvider(): AiProvider {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  if (!apiKey) throw new AiProviderUnavailableError("GROQ_API_KEY is not configured.");
  return {
    name: "groq",
    model,
    async generate(request) {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Hosted AI provider returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
      const payload = await response.json();
      return {
        content: String(payload.choices?.[0]?.message?.content || ""),
        provider: "groq",
        model,
        inputTokens: Number.isFinite(payload.usage?.prompt_tokens) ? Number(payload.usage.prompt_tokens) : null,
        outputTokens: Number.isFinite(payload.usage?.completion_tokens) ? Number(payload.usage.completion_tokens) : null,
      };
    },
  };
}

export function getAiProvider(): AiProvider {
  const configured = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (configured === "groq") return groqProvider();
  if (configured === "ollama") return ollamaProvider();
  if (configured) throw new AiProviderUnavailableError(`Unsupported AI_PROVIDER: ${configured}`);
  if (process.env.GROQ_API_KEY) return groqProvider();
  if (process.env.NODE_ENV !== "production") return ollamaProvider();
  throw new AiProviderUnavailableError("AI research is not configured. Set GROQ_API_KEY for hosted inference.");
}

export function providerConfigured() {
  if (process.env.GROQ_API_KEY || String(process.env.AI_PROVIDER || "").toLowerCase() === "groq") return true;
  if (String(process.env.AI_PROVIDER || "").toLowerCase() === "ollama") return true;
  return process.env.NODE_ENV !== "production";
}

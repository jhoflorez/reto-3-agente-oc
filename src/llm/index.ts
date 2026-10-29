import type { LlmAdapter } from "./adapter"
import { OpenAiAdapter } from "./openai"

export function crearLlm(): LlmAdapter {
  return new OpenAiAdapter(
    process.env.OPENAI_API_KEY,
    process.env.LLM_MODEL ?? "gpt-4.1-mini",
    Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  )
}

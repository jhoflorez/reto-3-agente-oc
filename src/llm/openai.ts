import { z } from "zod"
import { LlmError, type DefHerramienta, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter"

const RespuestaSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullish(),
      tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }), extra_content: z.unknown().optional() })).optional(),
    }),
  })).min(1),
  usage: z.object({ total_tokens: z.number() }).optional(),
})
const ErrorSchema = z.object({ error: z.object({ message: z.string() }) })

type MensajeOpenAi =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown }[] }
  | { role: "tool"; tool_call_id: string; content: string }

function aOpenAi(m: Mensaje): MensajeOpenAi {
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content,
      ...(m.toolCalls ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.nombre, arguments: t.argumentos }, ...(t.extra ? { extra_content: t.extra } : {}) })) } : {}),
    }
  }
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content }
  return { role: m.role, content: m.content }
}

export class OpenAiAdapter implements LlmAdapter {
  readonly provider = "openai"
  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly timeoutMs = 60000,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai",
  ) {}

  async enviar(mensajes: Mensaje[], herramientas: DefHerramienta[]): Promise<RespuestaLlm> {
    if (!this.apiKey) throw new LlmError("El servidor no tiene configurada la clave del modelo (OPENAI_API_KEY).")
    const body = {
      model: this.model,
      messages: mensajes.map(aOpenAi),
      ...(herramientas.length > 0
        ? {
            tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } })),
            tool_choice: "auto",
            parallel_tool_calls: false,
          }
        : {}),
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const crudo: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        console.error("Gemini error", res.status, JSON.stringify(crudo).slice(0, 1500))
        if (res.status === 401) throw new LlmError("OpenAI rechazó la clave configurada en el servidor.")
        if (res.status === 429) throw new LlmError("OpenAI limitó las solicitudes o la cuota se agotó. Intenta de nuevo en un momento.")
        const det = ErrorSchema.safeParse(crudo)
        throw new LlmError(`OpenAI respondió ${res.status}${det.success ? `: ${det.data.error.message.slice(0, 200)}` : ""}`)
      }
      const r = RespuestaSchema.safeParse(crudo)
      if (!r.success) throw new LlmError("Respuesta inesperada del proveedor del modelo.")
      const msg = r.data.choices[0]?.message
      return {
        contenido: msg?.content ?? null,
        llamadas: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, nombre: t.function.name, argumentos: t.function.arguments, extra: t.extra_content })),
        tokens: r.data.usage?.total_tokens ?? 0,
      }
    } catch (e) {
      if (e instanceof LlmError) throw e
      if (e instanceof Error && e.name === "AbortError") throw new LlmError("El modelo tardó demasiado en responder (timeout). Intenta de nuevo.")
      throw new LlmError("No se pudo contactar al proveedor del modelo.")
    } finally {
      clearTimeout(timer)
    }
  }
}

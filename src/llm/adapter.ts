export type LlamadaHerramienta = { id: string; nombre: string; argumentos: string; extra?: unknown }

export type Mensaje =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: LlamadaHerramienta[] }
  | { role: "tool"; toolCallId: string; content: string }

export type DefHerramienta = { nombre: string; descripcion: string; parametros: Record<string, unknown> }

export type RespuestaLlm = { contenido: string | null; llamadas: LlamadaHerramienta[]; tokens: number }

/** Error del proveedor con mensaje apto para mostrar al usuario (sin datos sensibles). */
export class LlmError extends Error {}

/** Interfaz propia: cambiar de proveedor no toca el ciclo del agente. */
export interface LlmAdapter {
  readonly provider: string
  readonly model: string
  enviar(mensajes: Mensaje[], herramientas: DefHerramienta[]): Promise<RespuestaLlm>
}

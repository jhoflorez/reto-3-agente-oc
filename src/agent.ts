import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import * as oc from "./tools/oc"
import { LlmError, type DefHerramienta, type LlmAdapter, type Mensaje } from "./llm/adapter"

const ROOT = process.cwd()
const MAX_ITERACIONES = Number(process.env.MAX_ITERACIONES ?? 25)
const MAX_TOKENS_SESION = Number(process.env.MAX_TOKENS_SESION ?? 200000)
/** Argumentos que el modelo no debe enviar: las herramientas releen todo desde fixtures. */
const OCULTOS = new Set(["paquete", "derivados", "payload"])

// ── comportamiento (prompt.md) + conocimiento (knowledge/) fuera del código ──
const prompt = readFileSync(join(ROOT, "agent", "prompt.md"), "utf8")
const conocimiento = readFileSync(join(ROOT, "src", "knowledge", "ordenes-compra.md"), "utf8")
const SYSTEM = `${prompt}\n\n# Conocimiento del proceso\n\n${conocimiento}`

// ── registro de herramientas: nombre visible = oc_<export> ──
const ctxHerramientas = { directory: ROOT, sessionId: "" }
type Registro = { def: DefHerramienta; run: (args: Record<string, unknown>, sessionId: string) => Promise<string> }
const registro = new Map<string, Registro>()
for (const [nombre, t] of Object.entries(oc)) {
  const visibles = Object.fromEntries(Object.entries(t.args).filter(([k]) => !OCULTOS.has(k)))
  const json = zodToJsonSchema(z.object(visibles), { target: "openAi" }) as unknown as Record<string, unknown>
  delete json["$schema"]
  registro.set(`oc_${nombre}`, {
    def: { nombre: `oc_${nombre}`, descripcion: t.description, parametros: json },
    run: (args, sessionId) => t.execute(args as never, { ...ctxHerramientas, sessionId }),
  })
}
const DEFS = [...registro.values()].map((r) => r.def)

// ── sesiones en memoria ──
type Sesion = { id: string; mensajes: Mensaje[]; tokens: number; pendiente: boolean }
const sesiones = new Map<string, Sesion>()
export const MAX_SESIONES = 200

export function obtenerSesion(id: string): Sesion | null {
  return sesiones.get(id) ?? null
}
export function historial(id: string): Mensaje[] | null {
  const s = sesiones.get(id)
  return s ? s.mensajes.filter((m) => m.role !== "system") : null
}
function sesion(id: string): Sesion {
  let s = sesiones.get(id)
  if (!s) {
    s = { id, mensajes: [{ role: "system", content: SYSTEM }], tokens: 0, pendiente: false }
    sesiones.set(id, s)
  }
  return s
}
export const hayCupo = (id: string): boolean => sesiones.has(id) || sesiones.size < MAX_SESIONES

// ── log de herramientas (CA4) ──
function registrar(sessionId: string, tool: string, args: unknown, resultado: string) {
  mkdirSync(join(ROOT, "out"), { recursive: true })
  appendFileSync(join(ROOT, "out", "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), sessionId, tool, args, resultado: resultado.slice(0, 2000) }) + "\n")
}

export type VistaLlamada = { nombre: string; argumentos: Record<string, unknown>; ok: boolean; resultado: string }
export type RespuestaTurno = { reply: string; toolCalls: VistaLlamada[]; needsConfirmation: boolean }

type ResultadoHerramienta = { ok: boolean; needs_confirmation?: boolean; data?: { apta?: boolean; confirmaciones?: unknown[] } }

export async function turno(llm: LlmAdapter, sessionId: string, texto: string): Promise<RespuestaTurno> {
  const s = sesion(sessionId)
  const confirmacionHabilitada = s.pendiente // CA3: solo vale si el turno anterior terminó pidiendo confirmación
  const toolCalls: VistaLlamada[] = []
  let pendiente = false

  if (s.tokens >= MAX_TOKENS_SESION) {
    return { reply: "Esta sesión alcanzó su límite de uso. Abre una sesión nueva para continuar.", toolCalls, needsConfirmation: false }
  }
  s.mensajes.push({ role: "user", content: texto })

  try {
    let reply = ""
    for (let i = 0; i < MAX_ITERACIONES && reply === ""; i++) {
      const r = await llm.enviar(s.mensajes, DEFS)
      s.tokens += r.tokens
      s.mensajes.push({ role: "assistant", content: r.contenido, ...(r.llamadas.length > 0 ? { toolCalls: r.llamadas } : {}) })
      if (r.llamadas.length === 0) { reply = r.contenido ?? "(sin respuesta)"; break }

      for (const ll of r.llamadas) {
        let args: Record<string, unknown> = {}
        let resultado: string
        const herramienta = registro.get(ll.nombre)
        try { args = JSON.parse(ll.argumentos || "{}") as Record<string, unknown> } catch { args = {} }
        if (!herramienta) {
          resultado = JSON.stringify({ ok: false, error: `Herramienta desconocida: ${ll.nombre}` })
        } else {
          if (ll.nombre === "oc_crear") args["confirmado"] = args["confirmado"] === true && confirmacionHabilitada
          resultado = await herramienta.run(args, sessionId)
        }
        registrar(sessionId, ll.nombre, args, resultado)
        const parsed = JSON.parse(resultado) as ResultadoHerramienta
        if (ll.nombre === "oc_validar" && parsed.ok && parsed.data?.apta && (parsed.data.confirmaciones?.length ?? 0) > 0) pendiente = true
        if (ll.nombre === "oc_crear") pendiente = !parsed.ok && parsed.needs_confirmation === true
        toolCalls.push({ nombre: ll.nombre, argumentos: args, ok: parsed.ok, resultado: resultado.slice(0, 3000) })
        s.mensajes.push({ role: "tool", toolCallId: ll.id, content: resultado })
      }
    }
    if (reply === "") {
      // CA1: tope alcanzado → responder con lo que hay y lo que falta
      s.mensajes.push({ role: "system", content: "Se alcanzó el tope de pasos. Responde ahora, sin herramientas, con lo que lograste y lo que falta." })
      const fin = await llm.enviar(s.mensajes, [])
      s.tokens += fin.tokens
      reply = fin.contenido ?? "Alcancé el tope de pasos sin completar el proceso."
      s.mensajes.push({ role: "assistant", content: reply })
    }
    s.pendiente = pendiente
    return { reply, toolCalls, needsConfirmation: pendiente }
  } catch (e) {
    s.pendiente = false
    const msg = e instanceof LlmError ? e.message : "Ocurrió un error interno procesando tu mensaje."
    return { reply: `⚠️ ${msg} La sesión sigue activa; puedes reintentar.`, toolCalls, needsConfirmation: false }
  }
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { crearLlm } from "./llm"
import { hayCupo, historial, turno } from "./agent"

rmSync("out", { recursive: true, force: true })
mkdirSync("out", { recursive: true })

const llm = crearLlm()
const PORT = Number(process.env.PORT ?? 3000)
const ocupadas = new Set<string>()
const ChatSchema = z.object({
  sessionId: z.string().regex(/^[\w-]{1,64}$/),
  message: z.string().trim().min(1).max(2000),
})

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let datos = ""
    req.on("data", (c: Buffer) => {
      datos += c.toString("utf8")
      if (datos.length > 16_000) { reject(new Error("Cuerpo demasiado grande")); req.destroy() }
    })
    req.on("end", () => resolve(datos))
    req.on("error", reject)
  })
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      return res.end(readFileSync(join(process.cwd(), "web", "index.html")))
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, provider: llm.provider, model: llm.model })
    }
    const m = /^\/api\/sessions\/([\w-]{1,64})$/.exec(url.pathname)
    if (req.method === "GET" && m?.[1]) {
      const h = historial(m[1])
      return h ? json(res, 200, { sessionId: m[1], mensajes: h }) : json(res, 404, { error: "Sesión no encontrada" })
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      let cuerpo: unknown
      try { cuerpo = JSON.parse(await leerCuerpo(req)) } catch { return json(res, 400, { error: "JSON inválido o demasiado grande" }) }
      const p = ChatSchema.safeParse(cuerpo)
      if (!p.success) return json(res, 400, { error: "Se requiere sessionId y message (1 a 2000 caracteres)" })
      const { sessionId, message } = p.data
      if (!hayCupo(sessionId)) return json(res, 503, { error: "Servidor con demasiadas sesiones activas. Intenta más tarde." })
      if (ocupadas.has(sessionId)) return json(res, 429, { error: "Esta sesión aún está procesando el mensaje anterior." })
      ocupadas.add(sessionId)
      try { return json(res, 200, await turno(llm, sessionId, message)) } finally { ocupadas.delete(sessionId) }
    }
    json(res, 404, { error: "No encontrado" })
  } catch {
    json(res, 500, { error: "Error interno" })
  }
}).listen(PORT, "0.0.0.0", () =>
  console.log(`Agente OC listo en http://localhost:${PORT} (${llm.provider} / ${llm.model})`)
)

import { rmSync } from "node:fs"
import * as oc from "./src/tools/oc"

type Salida = { ok: boolean; data?: Record<string, unknown>; error?: string; [k: string]: unknown }
const ctx = { directory: process.cwd(), sessionId: "demo" }
const llamar = async (r: Promise<string>): Promise<Salida> => JSON.parse(await r) as Salida
const codigos = (x: unknown): string => (Array.isArray(x) ? x.map((h: { codigo: string }) => h.codigo).join(", ") || "—" : "—")

rmSync("out", { recursive: true, force: true })

async function procesar(caso: string, confirmar = false) {
  console.log(`\n=== ${caso} ===`)
  const leido = await llamar(oc.leer_paquete.execute({ caso }, ctx))
  if (!leido.ok) return console.log(`  ✗ lectura: ${leido.error}`)
  const val = await llamar(oc.validar.execute({ caso }, ctx))
  const v = (val.data ?? {}) as Record<string, unknown>
  console.log(`  apta=${v.apta} retroactiva=${v.retroactiva}`)
  console.log(`  bloqueos: ${codigos(v.bloqueos)}`)
  console.log(`  confirmaciones: ${codigos(v.confirmaciones)}`)
  if (Array.isArray(v.confirmaciones)) for (const c of v.confirmaciones as { detalle: string }[]) console.log(`    · ${c.detalle}`)

  let payload: unknown
  if (v.apta) {
    const p = await llamar(oc.construir_payload.execute({ caso }, ctx))
    payload = p.data?.orden
    await llamar(oc.generar_evidencia.execute({ caso }, ctx))
  }
  const r1 = await llamar(oc.crear.execute({ caso, payload }, ctx))
  console.log(`  crear → ${r1.ok ? JSON.stringify(r1.data) : `NO creada: ${r1.error}`}`)
  if (confirmar && !r1.ok && r1.needs_confirmation) {
    const r2 = await llamar(oc.crear.execute({ caso, payload, confirmado: true }, ctx))
    console.log(`  crear (confirmado=true) → ${r2.ok ? JSON.stringify(r2.data) : r2.error}`)
  }
}

for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
  await procesar(caso, caso === "sol-004") // confirmación explícita solo en sol-004
}
console.log("\n=== Idempotencia: sol-001 otra vez ===")
console.log(" ", await oc.crear.execute({ caso: "sol-001" }, ctx))
console.log("\nControl: out/control.csv")

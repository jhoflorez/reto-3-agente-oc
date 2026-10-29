import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SapAdapter } from "./adapter"
import { ProveedoresSchema, type OrdenCompra } from "../types"

type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }
const PRIMER_NUMERO = 4500000001

const nitBase = (s: string): string => (s.split("-")[0] ?? "").replace(/\D/g, "")

/** SAP simulado: persiste en out/sap/ordenes.jsonl */
export class MockSap implements SapAdapter {
  private readonly archivo: string
  constructor(private readonly root: string) {
    const dir = join(root, "out", "sap")
    mkdirSync(dir, { recursive: true })
    this.archivo = join(dir, "ordenes.jsonl")
  }

  private leer(): Registro[] {
    if (!existsSync(this.archivo)) return []
    return readFileSync(this.archivo, "utf8")
      .split("\n").filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Registro)
  }

  async consultarProveedor(nit: string) {
    const ruta = join(this.root, "fixtures", "reto-03", "maestros", "proveedores.json")
    const lista = ProveedoresSchema.parse(JSON.parse(readFileSync(ruta, "utf8")))
    const p = lista.find((x) => nitBase(x.nit) === nitBase(nit))
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = this.leer().find((x) => x.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  async crearOrden(orden: OrdenCompra) {
    const existente = this.leer().find((x) => x.solicitud_id === orden.referencia.solicitud_id)
    if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }
    const numero_oc = String(PRIMER_NUMERO + this.leer().length)
    const fecha = new Date().toISOString()
    const reg: Registro = { numero_oc, fecha, solicitud_id: orden.referencia.solicitud_id, orden }
    appendFileSync(this.archivo, JSON.stringify(reg) + "\n")
    return { numero_oc, fecha }
  }
}

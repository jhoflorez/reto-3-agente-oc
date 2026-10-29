import { z } from "zod"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MockSap } from "../sap/mock"
import {
  AprobacionRawSchema, CentrosSchema, CorreoSchema, OrdenCompraSchema, ProveedoresSchema, SolicitudSchema,
  type AprobacionRaw, type Derivados, type Hallazgo, type OrdenCompra, type Paquete, type Validacion,
} from "../types"

type Ctx = { directory: string; sessionId: string }

// ───────────── infraestructura de herramientas ─────────────

class ToolFail extends Error {
  constructor(message: string, readonly extra: Record<string, unknown> = {}) { super(message) }
}

function defineTool<S extends z.ZodRawShape>(def: {
  description: string
  args: S
  run: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<unknown> | unknown
}) {
  const schema = z.object(def.args)
  return {
    description: def.description,
    args: def.args,
    /** Nunca lanza: siempre devuelve JSON { ok, data } | { ok: false, error } */
    async execute(args: z.input<typeof schema>, ctx: Ctx): Promise<string> {
      try {
        const parsed = schema.safeParse(args)
        if (!parsed.success) {
          const det = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          return JSON.stringify({ ok: false, error: `Argumentos inválidos: ${det}` })
        }
        return JSON.stringify({ ok: true, data: await def.run(parsed.data, ctx) })
      } catch (e) {
        if (e instanceof ToolFail) return JSON.stringify({ ok: false, error: e.message, ...e.extra })
        const msg = e instanceof Error ? e.message : String(e)
        return JSON.stringify({ ok: false, error: `Error inesperado: ${msg}` })
      }
    },
  }
}

// ───────────── lectura de fixtures ─────────────

const casoDir = (ctx: Ctx, caso: string): string => {
  if (!/^[\w-]+$/.test(caso)) throw new ToolFail(`Nombre de caso inválido: "${caso}"`)
  return join(ctx.directory, "fixtures", "reto-03", "solicitudes", caso)
}

function leerJson<T>(ruta: string, schema: z.ZodType<T>, etiqueta: string): T {
  let crudo: string
  try { crudo = readFileSync(ruta, "utf8") } catch { throw new ToolFail(`No se pudo leer ${etiqueta}`) }
  let json: unknown
  try { json = JSON.parse(crudo) } catch { throw new ToolFail(`${etiqueta} es JSON malformado`) }
  const r = schema.safeParse(json)
  if (!r.success) {
    const det = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new ToolFail(`${etiqueta} no cumple el formato esperado (${det})`)
  }
  return r.data
}

function parseMonto(txt: string): number | null {
  let t = txt.replace(/[^\d.,]/g, "")
  if (!t) return null
  const lastDot = t.lastIndexOf("."), lastCom = t.lastIndexOf(",")
  if (lastDot >= 0 && lastCom >= 0) {
    const dec = Math.max(lastDot, lastCom)
    t = t.slice(0, dec).replace(/[.,]/g, "") + "." + t.slice(dec + 1)
  } else if (lastDot >= 0 || lastCom >= 0) {
    const sep = lastDot >= 0 ? "." : ","
    const partes = t.split(sep)
    const ultima = partes[partes.length - 1] ?? ""
    t = partes.length > 2 || ultima.length === 3 ? partes.join("") : partes.join(".")
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const ultimoMonto = (linea: string | undefined): number | null => {
  const nums = linea?.match(/\d[\d.,]*/g)
  const ult = nums?.[nums.length - 1]
  return ult ? parseMonto(ult) : null
}

function parseCotizacion(texto: string): NonNullable<Paquete["cotizacion"]> {
  const lineasTotal = texto.split(/\r?\n/).filter((l) => /^\s*total\b/i.test(l))
  const total = ultimoMonto(lineasTotal[lineasTotal.length - 1])
  if (total === null) throw new ToolFail("cotizacion.txt: no se encontró una línea 'Total' con monto numérico")
  return {
    proveedor: /proveedor\s*:\s*(.+)/i.exec(texto)?.[1]?.trim() ?? "",
    nit: /nit\s*:?\s*([\d.\-]+)/i.exec(texto)?.[1] ?? null,
    total,
    moneda: /\b(COP|USD)\b/.exec(texto)?.[1] ?? "COP",
    validez_hasta: /validez[^\d\n]*(\d{4}-\d{2}-\d{2})/i.exec(texto)?.[1] ?? null,
    texto,
  }
}

function parseFactura(texto: string): NonNullable<Paquete["factura"]> {
  const lineasTotal = texto.split(/\r?\n/).filter((l) => /^\s*total\b/i.test(l))
  const total = ultimoMonto(lineasTotal[lineasTotal.length - 1])
  const fecha = /fecha[^\d\n]*(\d{4}-\d{2}-\d{2})/i.exec(texto)?.[1]
  if (total === null || !fecha) throw new ToolFail("factura.txt: faltan fecha (AAAA-MM-DD) o total numérico")
  const numero = /(?:factura|n[úu]mero|no\.?)\s*(?:n[úu]mero|no\.?|#|:)?\s*:?\s*([A-Z0-9][A-Z0-9\-]*)/i.exec(texto)?.[1] ?? "s/n"
  return { numero, fecha, total }
}

const leerOpcional = (ruta: string): string | null => (existsSync(ruta) ? readFileSync(ruta, "utf8") : null)

type Cargado = { paquete: Paquete; faltantes: string[]; aprobacionRaw: AprobacionRaw | null }

function cargarPaquete(ctx: Ctx, caso: string): Cargado {
  const dir = casoDir(ctx, caso)
  if (!existsSync(dir)) throw new ToolFail(`No existe el caso "${caso}" en fixtures/reto-03/solicitudes/`)
  const faltantes: string[] = []

  const correo = leerJson(join(dir, "correo.json"), CorreoSchema, "correo.json")
  const solicitud = leerJson(join(dir, "solicitud.json"), SolicitudSchema, "solicitud.json")

  const cotTxt = leerOpcional(join(dir, "cotizacion.txt"))
  if (cotTxt === null) faltantes.push("cotizacion.txt")

  let aprobacionRaw: AprobacionRaw | null = null
  if (existsSync(join(dir, "aprobacion.json"))) {
    aprobacionRaw = leerJson(join(dir, "aprobacion.json"), AprobacionRawSchema, "aprobacion.json")
  } else faltantes.push("aprobacion.json")

  const facTxt = leerOpcional(join(dir, "factura.txt")) // opcional: su ausencia es normal

  const paquete: Paquete = {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: cotTxt === null ? null : parseCotizacion(cotTxt),
    aprobacion: aprobacionRaw && {
      de: aprobacionRaw.de,
      fecha: aprobacionRaw.fecha,
      aprobado: /\baprobado\b/i.test(aprobacionRaw.cuerpo) && !/\bno\s+(?:est[aá]\s+)?aprobado/i.test(aprobacionRaw.cuerpo),
      texto: aprobacionRaw.cuerpo,
    },
    factura: facTxt === null ? null : parseFactura(facTxt),
  }
  return { paquete, faltantes, aprobacionRaw }
}

function cargarMaestros(ctx: Ctx) {
  const base = join(ctx.directory, "fixtures", "reto-03", "maestros")
  return {
    proveedores: leerJson(join(base, "proveedores.json"), ProveedoresSchema, "proveedores.json"),
    centros: leerJson(join(base, "centros-costo.json"), CentrosSchema, "centros-costo.json"),
  }
}

// ───────────── reglas de control (RC1–RC10) ─────────────

const nitBase = (s: string): string => (s.split("-")[0] ?? "").replace(/\D/g, "")
const normNombre = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(s a s|sas|s a|sa|ltda|s en c|e u)\b/g, " ")
    .replace(/\s+/g, " ").trim()
const emailDe = (s: string): string => (/[\w.+-]+@[\w.-]+/.exec(s)?.[0] ?? s).toLowerCase()
const fmt = (n: number): string => n.toLocaleString("es-CO")
const antes = (a: string, b: string): boolean => {
  const x = Date.parse(a), y = Date.parse(b)
  return !Number.isNaN(x) && !Number.isNaN(y) && x < y
}

function evaluar(ctx: Ctx, caso: string): { cargado: Cargado; validacion: Validacion } {
  const cargado = cargarPaquete(ctx, caso)
  const { paquete: p } = cargado
  const s = p.solicitud
  const m = cargarMaestros(ctx)
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const derivados: Derivados = {}
  const bloq = (codigo: string, detalle: string) => bloqueos.push({ codigo, detalle })
  const conf = (codigo: string, detalle: string) => confirmaciones.push({ codigo, detalle })

  if (s.moneda !== "COP" && s.moneda !== "USD") bloq("MONEDA", `Moneda "${s.moneda}" no soportada (COP o USD)`)

  // RC1 proveedor
  const prov = s.proveedor_nit
    ? m.proveedores.find((x) => nitBase(x.nit) === nitBase(s.proveedor_nit ?? ""))
    : m.proveedores.find((x) => normNombre(x.nombre) === normNombre(s.proveedor_nombre))
  if (!prov) bloq("RC1", `Proveedor "${s.proveedor_nombre}"${s.proveedor_nit ? ` (NIT ${s.proveedor_nit})` : ""} no existe en el maestro`)
  else {
    derivados.proveedor = { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre }
    if (!prov.activo) bloq("RC1", `Proveedor ${prov.nombre} está inactivo en SAP`)
  }

  // RC4 subárea
  const centro = m.centros.find((c) => c.centro_costo === s.centro_costo)
  if (!centro) bloq("RC4", `Centro de costo ${s.centro_costo} no existe`)
  else if (!centro.subareas.includes(s.subarea)) bloq("RC4", `Subárea ${s.subarea} no pertenece al centro ${s.centro_costo}`)

  // RC2 / RC3 aprobación y tope
  const a = p.aprobacion
  if (!a) bloq("RC2", "No hay correo de aprobación")
  else if (!a.aprobado) bloq("RC2", "El correo de aprobación no contiene \"Aprobado\"")
  if (a && centro) {
    const ap = centro.aprobadores.find((x) => x.email.toLowerCase() === emailDe(a.de))
    if (!ap) bloq("RC2", `${a.de} no figura como aprobador del centro ${s.centro_costo}`)
    else {
      derivados.aprobador_email = ap.email
      if (s.valor_total > ap.tope) bloq("RC3", `Valor ${fmt(s.valor_total)} supera el tope de ${ap.email} (${fmt(ap.tope)})`)
    }
  }

  // RC10 aritmética
  const calc = s.cantidad * s.valor_unitario
  if (Math.abs(calc - s.valor_total) > 1) bloq("RC10", `cantidad × valor_unitario = ${fmt(calc)} ≠ valor_total ${fmt(s.valor_total)}`)

  // RC5 cotización vs solicitud
  if (!p.cotizacion) conf("RC5", "No hay cotización adjunta")
  else {
    const dif = Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total
    if (dif > 0.02) conf("RC5", `Cotización ${fmt(p.cotizacion.total)} vs solicitud ${fmt(s.valor_total)} (${(dif * 100).toFixed(1)} % de diferencia, tolerancia 2 %)`)
  }

  // RC6 / RC7 derivados desde el proveedor
  if (!s.indicador_iva && prov) {
    derivados.indicador_iva = prov.indicador_iva_default
    conf("RC6", `Indicador de IVA no informado; se propone ${prov.indicador_iva_default} (default del proveedor)`)
  }
  if (!s.condiciones_pago && prov) derivados.condiciones_pago = prov.condiciones_pago_default

  // RC8 retroactiva
  const retroactiva = !!p.factura && antes(p.factura.fecha, s.fecha_solicitud)
  if (retroactiva && p.factura) conf("RC8", `OC retroactiva: factura ${p.factura.numero} del ${p.factura.fecha} es anterior a la solicitud del ${s.fecha_solicitud}`)

  // RC9 fecha de aprobación
  if (a && antes(a.fecha, s.fecha_solicitud)) conf("RC9", `Aprobación (${a.fecha}) anterior a la solicitud (${s.fecha_solicitud})`)

  return { cargado, validacion: { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva } }
}

// ───────────── evidencia ─────────────

const textoEvidencia = (r: AprobacionRaw): string =>
  `De: ${r.de}\nPara: ${r.para}\nFecha: ${r.fecha}\nAsunto: ${r.asunto}\n\n${r.cuerpo}`
const sha256 = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex")

// ───────────── payload ─────────────

function construirOrden(ctx: Ctx, caso: string, confirmadoPor: string | null) {
  const { cargado, validacion: v } = evaluar(ctx, caso)
  if (!v.apta) throw new ToolFail(`No se puede construir el payload: bloqueos ${v.bloqueos.map((b) => b.codigo).join(", ")}`, { bloqueos: v.bloqueos })
  const { paquete: p, aprobacionRaw } = cargado
  const s = p.solicitud
  const d = v.derivados
  if (!d.proveedor || !d.aprobador_email || !p.aprobacion || !aprobacionRaw) throw new ToolFail("Faltan datos de proveedor o aprobación")

  const iva = s.indicador_iva ?? d.indicador_iva
  const pago = s.condiciones_pago ?? d.condiciones_pago
  if (!iva || !pago) throw new ToolFail("No se pudo determinar indicador de IVA o condiciones de pago")

  const orden: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion ? `${caso}/cotizacion.txt` : null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: d.proveedor,
    moneda: s.moneda === "USD" ? "USD" : "COP",
    condiciones_pago: pago,
    aprobador: { email: d.aprobador_email, fecha_aprobacion: p.aprobacion.fecha, evidencia_sha256: sha256(textoEvidencia(aprobacionRaw)) },
    posiciones: [{
      numero: 10,
      descripcion: s.descripcion.slice(0, 40),
      cantidad: s.cantidad,
      unidad: "UN", // supuesto: la solicitud no trae unidad de medida
      precio_unitario: s.valor_unitario,
      centro_costo: s.centro_costo,
      subarea: s.subarea,
      indicador_iva: iva,
    }],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: confirmadoPor })),
  }
  const valido = OrdenCompraSchema.safeParse(orden)
  if (!valido.success) throw new ToolFail(`El payload no cumple el esquema: ${valido.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)

  const fuente = (campo: string, origen: string) => ({ campo, origen })
  const trazabilidad = [
    fuente("referencia.solicitud_id", "solicitud"), fuente("referencia.correo_id", "correo"),
    fuente("referencia.cotizacion_ref", "cotizacion"),
    fuente("proveedor", "maestro.proveedores"),
    fuente("moneda", "solicitud"),
    fuente("condiciones_pago", s.condiciones_pago ? "solicitud" : "derivado (maestro.proveedores)"),
    fuente("aprobador.email", "maestro.centros-costo"), fuente("aprobador.fecha_aprobacion", "aprobacion"),
    fuente("aprobador.evidencia_sha256", "derivado (sha256 de la evidencia)"),
    fuente("posiciones[0].descripcion", s.descripcion.length > 40 ? "solicitud (truncada a 40)" : "solicitud"),
    fuente("posiciones[0].cantidad", "solicitud"), fuente("posiciones[0].precio_unitario", "solicitud"),
    fuente("posiciones[0].centro_costo", "solicitud"), fuente("posiciones[0].subarea", "solicitud"),
    fuente("posiciones[0].indicador_iva", s.indicador_iva ? "solicitud" : "derivado (maestro.proveedores)"),
    fuente("posiciones[0].unidad", "derivado (supuesto: UN)"),
  ]
  return { orden: valido.data, trazabilidad, validacion: v }
}

const sinExcepciones = (o: OrdenCompra) => JSON.stringify({ ...o, excepciones: [] })

// ───────────── control.csv ─────────────

function registrarControl(ctx: Ctx, fila: { solicitud_id: string; resultado: string; numero_oc: string; retroactiva: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[] }) {
  const ruta = join(ctx.directory, "out", "control.csv")
  mkdirSync(join(ctx.directory, "out"), { recursive: true })
  if (!existsSync(ruta)) writeFileSync(ruta, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n")
  const q = (x: string) => `"${x.replace(/"/g, '""')}"`
  appendFileSync(ruta, [
    q(fila.solicitud_id), fila.resultado, fila.numero_oc, String(fila.retroactiva),
    q(fila.bloqueos.map((b) => b.codigo).join("|")), q(fila.confirmaciones.map((c) => c.codigo).join("|")),
    new Date().toISOString(),
  ].join(",") + "\n")
}

// ───────────── herramientas exportadas (oc_<export>) ─────────────

const argCaso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001")

export const leer_paquete = defineTool({
  description: "Lee y normaliza el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe).",
  args: { caso: argCaso },
  run: ({ caso }, ctx) => {
    const { paquete, faltantes } = cargarPaquete(ctx, caso)
    return { ...paquete, faltantes }
  },
})

export const validar = defineTool({
  description: "Valida el caso contra maestros y controles RC1–RC10; devuelve bloqueos, confirmaciones, valores derivados y si es retroactiva.",
  args: {
    caso: argCaso,
    paquete: z.unknown().optional().describe("Opcional. Se ignora: la validación siempre relee los fixtures para que el modelo no pueda alterar valores."),
  },
  run: ({ caso }, ctx) => evaluar(ctx, caso).validacion,
})

export const construir_payload = defineTool({
  description: "Construye la orden de compra tal como quedaría en SAP (validada con zod) y guarda su trazabilidad; falla si hay bloqueos.",
  args: {
    caso: argCaso,
    paquete: z.unknown().optional().describe("Opcional. Se ignora: el payload se reconstruye desde fixtures y maestros."),
    derivados: z.unknown().optional().describe("Opcional. Se ignora: los derivados se recalculan desde los maestros."),
  },
  run: ({ caso }, ctx) => {
    const { orden, trazabilidad } = construirOrden(ctx, caso, null)
    const dir = join(ctx.directory, "out", caso)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "trazabilidad.json"), JSON.stringify(trazabilidad, null, 2))
    return { orden, trazabilidad_ruta: `out/${caso}/trazabilidad.json` }
  },
})

export const generar_evidencia = defineTool({
  description: "Genera la evidencia de aprobación (encabezados, cuerpo y sha256) como archivo adjunto a la OC.",
  args: { caso: argCaso },
  run: ({ caso }, ctx) => {
    const { aprobacionRaw } = cargarPaquete(ctx, caso)
    if (!aprobacionRaw) throw new ToolFail("No hay correo de aprobación para generar evidencia")
    const contenido = textoEvidencia(aprobacionRaw)
    const hash = sha256(contenido)
    const dir = join(ctx.directory, "out", caso)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "aprobacion.txt"), `${contenido}\n\n---\nsha256: ${hash}\n`)
    return { ruta: `out/${caso}/aprobacion.txt`, sha256: hash }
  },
})

export const crear = defineTool({
  description: "Crea la OC en SAP simulado. Solo procede si no hay bloqueos y, de haber confirmaciones, si confirmado=true. Es idempotente por solicitud.",
  args: {
    caso: argCaso,
    payload: z.unknown().optional().describe("Payload devuelto por oc_construir_payload; si se envía debe coincidir con el validado."),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje."),
  },
  run: async ({ caso, payload, confirmado }, ctx) => {
    const { cargado, validacion: v } = evaluar(ctx, caso)
    const id = cargado.paquete.solicitud.solicitud_id
    const sap = new MockSap(ctx.directory)
    const log = (resultado: string, numero_oc = "") =>
      registrarControl(ctx, { solicitud_id: id, resultado, numero_oc, retroactiva: v.retroactiva, bloqueos: v.bloqueos, confirmaciones: v.confirmaciones })

    const existente = await sap.buscarOrdenPorReferencia(id)
    if (existente) { log("idempotente", existente.numero_oc); return { numero_oc: existente.numero_oc, fecha: null, idempotente: true } }

    if (!v.apta) { log("bloqueada"); throw new ToolFail("OC bloqueada: no cumple los controles", { bloqueos: v.bloqueos }) }
    if (v.confirmaciones.length > 0 && confirmado !== true) {
      log("pendiente_confirmacion")
      throw new ToolFail("Requiere confirmación humana antes de crear la OC", { needs_confirmation: true, confirmaciones: v.confirmaciones })
    }

    const { orden } = construirOrden(ctx, caso, confirmado ? "analista (chat)" : null)
    if (payload !== undefined) {
      const enviado = OrdenCompraSchema.safeParse(payload)
      if (!enviado.success || sinExcepciones(enviado.data) !== sinExcepciones(orden)) {
        throw new ToolFail("El payload enviado no coincide con el validado; vuelve a llamar oc_construir_payload")
      }
    }
    const { numero_oc, fecha } = await sap.crearOrden(orden)
    log("creada", numero_oc)
    return { numero_oc, fecha, idempotente: false }
  },
})

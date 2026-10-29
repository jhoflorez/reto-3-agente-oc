import { z } from "zod"

export const SolicitudSchema = z.object({
  solicitud_id: z.string(),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().nullish(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.string(),
  indicador_iva: z.string().nullish(),
  condiciones_pago: z.string().nullish(),
  fecha_solicitud: z.string(),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
})

export const AprobacionRawSchema = z.object({
  de: z.string(),
  para: z.string(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})
export type AprobacionRaw = z.infer<typeof AprobacionRawSchema>

export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: { proveedor: string; nit: string | null; total: number; moneda: string; validez_hasta: string | null; texto: string } | null
  aprobacion: { de: string; fecha: string; aprobado: boolean; texto: string } | null
  factura: { numero: string; fecha: string; total: number } | null
}

// ---- Maestros ----
export const ProveedoresSchema = z.array(z.object({
  codigo_sap: z.string(), nit: z.string(), nombre: z.string(),
  condiciones_pago_default: z.string(), indicador_iva_default: z.string(), activo: z.boolean(),
}))
export const CentrosSchema = z.array(z.object({
  centro_costo: z.string(), subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), tope: z.number() })),
}))

// ---- Orden de compra (7.4) ----
export const OrdenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z.array(z.object({
    numero: z.number(),
    descripcion: z.string().max(40),
    cantidad: z.number(),
    unidad: z.enum(["UN", "H", "MES"]),
    precio_unitario: z.number(),
    centro_costo: z.string(),
    subarea: z.string(),
    indicador_iva: z.string(),
  })).min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

export type Hallazgo = { codigo: string; detalle: string }
export type Derivados = {
  proveedor?: { codigo_sap: string; nit: string; nombre: string }
  aprobador_email?: string
  indicador_iva?: string
  condiciones_pago?: string
}
export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

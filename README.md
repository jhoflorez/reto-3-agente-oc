# Reto 03 · Agente conversacional "Órdenes de Compra SAP"

Agente de chat que lee el paquete de una compra, lo valida contra los maestros, construye la OC, genera la evidencia de aprobación y crea la OC en un SAP simulado. Las excepciones se devuelven a la analista con una recomendación.

**Link de prueba:** [COMPLETAR: URL pública]  
**Clave de acceso (si aplica):** [COMPLETAR o "ninguna"]

## Arranque en local (un comando)

Requisitos: [Bun](https://bun.sh) ≥ 1.1.

```bash
cp .env.example .env     # editar OPENAI_API_KEY
bun install && bun run dev
```

Abre http://localhost:3000. Los fixtures de Periferia van en `fixtures/reto-03/` (solo lectura).

## Variables de entorno

| Variable | Descripción | Por defecto |
|---|---|---|
| `OPENAI_API_KEY` | Clave del modelo. Solo vive en el backend. | — |
| `LLM_MODEL` | Modelo de OpenAI | `gpt-4.1-mini` |
| `LLM_TIMEOUT_MS` | Timeout por llamada al modelo | `60000` |
| `MAX_ITERACIONES` | Tope de ciclos herramienta→modelo por turno | `25` |
| `MAX_TOKENS_SESION` | Tope de tokens por sesión | `200000` |
| `PORT` | Puerto HTTP | `3000` |

## Demo sin modelo

```bash
bun run demo.ts
```

Procesa `sol-001` a `sol-006` llamando directamente a las herramientas. No necesita clave. Muestra `apta`, bloqueos, confirmaciones, `retroactiva`, número de OC o motivo, la idempotencia (`sol-001` dos veces) y la confirmación explícita de `sol-004`. Limpia `out/` al iniciar.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` (sin claves) |

## Salidas (`out/`)

- `sap/ordenes.jsonl`: OC del SAP simulado.
- `control.csv`: un registro por intento (`solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`).
- `log.jsonl`: toda llamada a herramienta.
- `<caso>/aprobacion.txt` y `<caso>/trazabilidad.json`.

## Estructura

`agent/prompt.md` (comportamiento) · `src/knowledge/` (conocimiento) · `src/tools/oc.ts` (ejecución) · `src/llm/` (adaptador del modelo) · `src/sap/` (adaptador SAP) · `src/agent.ts` (ciclo) · `src/server.ts` (HTTP) · `web/` (chat). Detalles en `SOLUCION.md`.

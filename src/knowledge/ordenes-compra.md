# Proceso de órdenes de compra (Periferia)

Cada compra llega por correo con tres piezas: solicitud (Excel), cotización del proveedor y correo de aprobación del líder. La analista crea la OC en SAP y adjunta el correo de aprobación como evidencia. Una OC por factura que ingresa.

## Reglas de control

| Código | Regla | Efecto |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo | Bloqueo |
| RC2 | Existe aprobación, contiene "Aprobado" y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización vs solicitud difieren más de 2 % (o no hay cotización) | Confirmación |
| RC6 | Indicador de IVA no informado: se propone el del proveedor | Confirmación + derivado |
| RC7 | Condiciones de pago no informadas: se toman del proveedor | Derivado (solo informar) |
| RC8 | Existe factura anterior a la fecha de la solicitud: OC retroactiva | Confirmación + marca |
| RC9 | La aprobación es anterior a la fecha de la solicitud | Confirmación |
| RC10 | cantidad × valor unitario no iguala el valor total (± 1) | Bloqueo |

## Acción sugerida por regla

- RC1 proveedor inexistente: pedir al solicitante el NIT correcto o gestionar la creación del proveedor en el maestro. Proveedor inactivo: solicitar su reactivación.
- RC2 sin aprobación válida: pedir al solicitante que reenvíe la solicitud al aprobador correcto del centro de costo.
- RC3 tope excedido: pedir aprobación de un aprobador con tope suficiente.
- RC4 subárea incorrecta: pedir al solicitante corregir centro de costo o subárea.
- RC5 diferencia de montos: preguntar al solicitante cuál valor es correcto; la analista decide si confirma.
- RC6 IVA: confirmar con el solicitante o contabilidad el indicador correcto.
- RC8 retroactiva: se crea solo con confirmación y queda marcada en el control para que la dirección mida el desvío de proceso.
- RC10 aritmética: pedir corrección de cantidad, valor unitario o total.

## Glosario

- **Bloqueo**: impide crear la OC.
- **Confirmación**: la OC puede crearse solo si la analista la confirma explícitamente.
- **Derivado**: valor completado desde un maestro, que se informa a la analista.
- **Retroactiva**: la OC se crea después de recibir la factura, saltándose la cotización.
- **Evidencia**: el correo de aprobación guardado con su huella sha256.

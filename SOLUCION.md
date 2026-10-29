# SOLUCION.md · Reto 03

## 1. Problema en una frase

Actualmente, la analista administrativa debe ingresar manualmente en SAP la información de cada factura, aunque gran parte de esos datos ya se encuentra disponible en correos, solicitudes y cotizaciones. Este proceso puede generar errores de digitación, inconsistencias en los valores y dificultades para hacer seguimiento a las órdenes de compra que se crean después de recibir una factura.

La solución busca automatizar este proceso, validar la información antes de generar una orden de compra y mantener una trazabilidad que permita identificar errores, excepciones y oportunidades de mejora.

## 2. Arquitectura

La solución se construye con una arquitectura modular, separando la interfaz, la lógica del agente, las herramientas de negocio y la integración con el sistema SAP.

```text
Front (web/index.html) ──HTTP──▶ Backend (src/server.ts)
  historial · tool calls ◀──────── ├─ Ciclo del agente (src/agent.ts)
  aviso de confirmación             │    prompt.md + knowledge/ → LlmAdapter → herramientas
                                    ├─ LlmAdapter (src/llm/adapter.ts → openai.ts)
                                    ├─ Herramientas zod (src/tools/oc.ts) ──▶ SapAdapter (mock.ts)
                                    └─ Sesiones en memoria
                                         │
                              fixtures/ (solo lectura)
                              out/ (escritura)
```

La responsabilidad de cada componente es la siguiente:

| Capa | Responsabilidad |
|---|---|
| Interfaz web | Permitir la interacción con el agente, consultar el historial y confirmar operaciones cuando corresponda. |
| Backend | Recibir las solicitudes del usuario y administrar las sesiones. |
| Agente | Coordinar las respuestas del modelo y la ejecución de las herramientas disponibles. |
| Prompt (`agent/prompt.md`) | Definir el comportamiento esperado del agente y las instrucciones que debe seguir. |
| Conocimiento (`src/knowledge/ordenes-compra.md`) | Documentar las reglas y el contexto del proceso de órdenes de compra. |
| Herramientas (`src/tools/oc.ts`) | Ejecutar las validaciones y aplicar las reglas de negocio. |
| Adaptador LLM | Desacoplar la lógica del agente del proveedor del modelo de lenguaje. |
| Adaptador SAP | Simular la creación de órdenes de compra y permitir sustituir posteriormente la implementación por una integración real. |
| Archivos de soporte | Mantener los datos de entrada en `fixtures/` y registrar los resultados en `out/`. |

Esta separación facilita el mantenimiento de la solución. Si se modifica una regla de negocio, el cambio debe realizarse principalmente en las herramientas correspondientes y en la documentación del proceso, sin necesidad de modificar todo el servidor.

## 3. Ciclo del agente

El método `turno()` de `src/agent.ts` administra la interacción entre el usuario, el modelo y las herramientas.

El agente recibe el mensaje del usuario, lo agrega al historial y realiza una llamada al modelo con las herramientas disponibles. Cuando el modelo solicita ejecutar una herramienta, el sistema procesa la solicitud, obtiene el resultado y lo devuelve al modelo para que continúe con el flujo. El proceso termina cuando el modelo genera una respuesta final sin solicitar nuevas herramientas.

Los principales controles del ciclo son:

- **Tope de iteraciones (CA1):** se establece un máximo de 25 iteraciones para evitar que el agente entre en un ciclo indefinido. Si alcanza ese límite, se realiza una última llamada sin herramientas para resumir lo que se logró y lo que queda pendiente.

- **Confirmación humana (CA3):** la creación de una orden de compra puede requerir confirmación explícita. Cuando las validaciones identifican condiciones que deben ser revisadas o la herramienta devuelve `needs_confirmation`, el sistema mantiene el estado pendiente. La confirmación se procesa en el siguiente turno y el código controla que el modelo no pueda asumir por su cuenta que el usuario ya autorizó la operación.

- **Manejo de errores (CA5):** los errores relacionados con el proveedor del modelo, como problemas de autenticación, cuota o tiempo de espera, se presentan al usuario de forma controlada. La sesión puede continuar, según el tipo de error y el estado del proceso.

- **Trazabilidad (CA4):** las llamadas a herramientas y sus resultados quedan registrados en el historial visible y en `out/log.jsonl`, de acuerdo con la implementación.

- **Control del consumo:** se establecen límites para la cantidad de iteraciones, los tokens por sesión, la longitud de los mensajes y el número de sesiones. También se limita la ejecución simultánea de solicitudes dentro de una misma sesión.

Estos controles buscan que el agente no se limite a responder preguntas, sino que ejecute el proceso de manera controlada y con intervención humana cuando sea necesario.

## 4. Elección del modelo

Proveedor: Google (Gemini).

Modelo: gemini-3.5-flash-lite, configurable mediante la configuración del proyecto.

Elegí este modelo porque el reto requiere interpretar solicitudes, coordinar herramientas y presentar resultados de forma clara, sin necesidad de delegar toda la lógica del proceso al modelo. Las validaciones críticas, las reglas de negocio y la construcción de la información para SAP se mantienen bajo el control del código, lo que permite tener un proceso más controlado y fácil de verificar.

Esta elección busca mantener un equilibrio entre costo, velocidad de respuesta y capacidad para trabajar con herramientas estructuradas. Para este tipo de solución, considero importante utilizar un modelo que permita ejecutar las tareas de manera eficiente, sin aumentar innecesariamente los costos de procesamiento.

Costo por caso: el costo depende de la cantidad de tokens consumidos durante la ejecución, incluyendo las instrucciones iniciales, el historial de conversación y las respuestas del modelo a las llamadas de herramientas. Para determinar el costo real, es necesario ejecutar los casos de prueba y registrar el consumo reportado por la API de Gemini. Con estos datos y las tarifas vigentes del modelo seleccionado, se podrá calcular el costo promedio por caso y estimar el consumo para un volumen determinado de facturas.

El valor numérico queda pendiente de validación con ejecuciones reales, por lo que no se presenta una cifra estimada sin contar con datos de consumo.

La arquitectura permite cambiar de modelo sin modificar el ciclo principal del agente, siempre que se mantenga la interfaz LlmAdapter. Para utilizar Gemini, el adaptador correspondiente debe implementar dicha interfaz y actualizarse la selección del proveedor en src/llm/index.ts. También es necesario validar que la integración soporte correctamente las llamadas a herramientas, el manejo de errores y el registro del consumo de tokens.
cd "reto-03 2"


## 5. Matriz de controles

Las reglas de negocio se centralizan en `evaluar()` dentro de `src/tools/oc.ts`. La información se vuelve a consultar desde los archivos de `fixtures/`, evitando depender exclusivamente de los datos que el modelo pueda enviar como argumentos.

| Regla | Implementación | Tipo de control |
|---|---|---|
| RC1 | Identificar al proveedor por NIT normalizado y, cuando no exista, por nombre normalizado. Validar que el proveedor esté activo. | Bloqueo |
| RC2 | Verificar que exista una aprobación válida, que contenga el estado esperado y que el remitente esté autorizado para aprobar en el centro correspondiente. | Bloqueo |
| RC3 | Comparar el valor total con el límite de aprobación del responsable. | Bloqueo |
| RC4 | Validar que el centro exista y que la subárea corresponda a dicho centro. | Bloqueo |
| RC5 | Solicitar confirmación cuando la diferencia entre los valores supere el 2 % o no exista cotización. Mostrar los valores comparados. | Confirmación |
| RC6 | Cuando no se informe el IVA, proponer el valor configurado para el proveedor y solicitar confirmación. | Confirmación y dato derivado |
| RC7 | Cuando no se especifique la condición de pago, utilizar la configurada para el proveedor. | Dato derivado |
| RC8 | Identificar cuando la factura tiene fecha anterior a la solicitud, marcar la orden como retroactiva y registrar la situación en `control.csv`. | Confirmación |
| RC9 | Identificar cuando la aprobación tiene fecha anterior a la solicitud. | Confirmación |
| RC10 | Verificar que la cantidad multiplicada por el precio unitario coincida con el total, con una tolerancia de una unidad monetaria. | Bloqueo |

**Control adicional de moneda:** las monedas diferentes de COP y USD se bloquean, de acuerdo con las restricciones definidas para el esquema de datos de la solución.

**La regla más difícil:** considero que uno de los principales retos es garantizar que los datos utilizados para crear la orden de compra sean correctos y consistentes. Por ejemplo, identificar al proveedor cuando el NIT no está disponible requiere cuidado para evitar asociar una factura con una empresa equivocada. También es importante interpretar correctamente los valores monetarios, porque los separadores de miles y decimales pueden variar entre documentos.

Desde mi enfoque de QA, este tipo de validaciones requiere contemplar tanto el flujo normal como los escenarios excepcionales. No basta con verificar que el sistema procese una factura correctamente; también hay que comprobar que detecte inconsistencias y evite generar órdenes de compra con información incorrecta.

## 6. Diseño del adaptador SAP real

**Opción propuesta:** utilizar la API OData `API_PURCHASEORDER_PROCESS_SRV` de SAP S/4HANA, expuesta a través de SAP Integration Suite o una capa de API Management, siempre que la versión y la configuración del sistema permitan utilizarla para este proceso.

La ventaja de esta alternativa es que permite integrar el backend mediante servicios HTTP, desacoplar la lógica del agente de la infraestructura interna de SAP y centralizar aspectos como la autenticación, las autorizaciones y la auditoría.

Si el sistema utilizado es SAP ECC o no dispone de la API requerida, se evaluaría una integración mediante `BAPI_PO_CREATE1` a través de RFC, detrás de un servicio intermedio.

Antes de implementar la integración definitiva, es necesario validar con el equipo SAP la versión del sistema, las interfaces habilitadas, los campos obligatorios y las restricciones de autorización.

### Mapeo del payload

El siguiente mapeo es una propuesta inicial y debe verificarse contra el contrato de la API y la configuración real de SAP.

| Payload de la solución | Campo SAP propuesto |
|---|---|
| `sociedad` | `CompanyCode` |
| `organizacion_compras` | `PurchasingOrganization` |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` |
| `posiciones[].numero` | `PurchaseOrderItem` |
| `posiciones[].descripcion` | `PurchaseOrderItemText` |
| `posiciones[].cantidad` | `OrderQuantity` |
| `posiciones[].unidad` | `PurchaseOrderQuantityUnit` |
| `posiciones[].precio_unitario` | `NetPriceAmount` |
| `posiciones[].indicador_iva` | `TaxCode` |
| `posiciones[].centro_costo` | `CostCenter`, dentro de la asignación contable correspondiente |

En caso de utilizar BAPI, el mapeo se realizaría mediante estructuras como `POHEADER`, `POHEADERX`, `POITEM`, `POITEMX`, `POACCOUNT` y `POACCOUNTX`, según los campos requeridos. La confirmación de la transacción se ejecutaría únicamente después de verificar que no existan errores bloqueantes en los mensajes devueltos por SAP.

### Datos adicionales requeridos

El payload simplificado puede no incluir todos los campos que SAP necesita para crear una orden de compra. Entre ellos se encuentran el grupo de compras, el centro o planta, el grupo de artículos, la cuenta contable y la fecha de entrega.

Estos valores deben resolverse mediante reglas de configuración aprobadas por el negocio y el equipo SAP. No deben ser inventados por el modelo. También se debe confirmar cómo se registra la subárea, ya que puede requerir una extensión o un campo específico de la implementación.

### Autenticación y credenciales

La integración debe utilizar una cuenta técnica con los permisos mínimos necesarios para ejecutar las operaciones autorizadas. La autenticación se definirá de acuerdo con las capacidades de la plataforma, por ejemplo, mediante OAuth 2.0 o certificados de cliente.

Las credenciales deben almacenarse en un gestor de secretos o mecanismo seguro equivalente y suministrarse al backend mediante variables de entorno o configuración protegida. No deben incluirse en el prompt, en el historial de conversación ni en los argumentos de las herramientas expuestas al modelo.

### Idempotencia y manejo de errores

Para evitar órdenes duplicadas, se propone utilizar el identificador de la solicitud como referencia única del proceso. Antes de crear una orden, el adaptador consultará si ya existe una operación asociada con esa referencia, utilizando un campo de SAP previamente validado con el equipo responsable.

Ante un tiempo de espera agotado o un error de comunicación, el sistema no debe repetir la creación de manera automática sin comprobar primero el estado de la operación. Debe consultar la referencia y determinar si la orden fue creada, si no existe o si el resultado sigue siendo ambiguo.

Si se presenta un resultado parcial o no se puede confirmar el estado de la operación, el proceso debe quedar pendiente de revisión y se debe informar a la analista. No se debe ejecutar un nuevo intento de creación hasta resolver la situación.

La atomicidad de la creación y el comportamiento ante errores deben comprobarse según la API o el mecanismo de integración utilizado. No se debe asumir que todas las operaciones OData o BAPI tienen el mismo comportamiento transaccional.

La evidencia documental, como `aprobacion.pdf`, se integraría mediante el servicio de adjuntos que corresponda a la instalación de SAP. La carga del documento debe tener su propia trazabilidad y control de duplicados, por ejemplo, mediante una huella SHA-256 y una referencia única.

### Plan alternativo si no existe conexión con SAP

Si no es viable establecer la conexión directa, el agente puede conservar las funcionalidades de lectura, validación, generación del payload y registro de excepciones.

Como alternativa, puede entregar a la analista una tabla con los campos organizados en el orden requerido por la pantalla de creación de órdenes de compra, o generar un archivo de carga masiva compatible con el mecanismo aprobado por la organización.

De esta manera, se reduce la digitación manual y se conservan los controles y la trazabilidad, aunque la creación definitiva continúe dependiendo de una acción humana.

## 7. Lectura del proceso: órdenes de compra retroactivas

La solución identifica las situaciones en las que la fecha de la factura es anterior a la fecha de la solicitud y registra la marca `retroactiva = true` en el control correspondiente.

Este dato permite pasar de una percepción del problema a una medición objetiva. Con la información acumulada, se puede calcular qué porcentaje de órdenes de compra presenta esta condición e identificar si existe concentración por proveedor, centro de costo o área.

Desde el punto de vista del negocio, una orden de compra creada después de la factura puede indicar que el gasto se comprometió sin completar oportunamente los controles previos. Esto puede limitar la comparación de cotizaciones y reducir la capacidad de verificar si la compra fue autorizada antes de asumir el compromiso.

Sin embargo, considero importante analizar primero las causas antes de establecer restricciones. Una situación retroactiva puede estar asociada a una urgencia real, a una demora en las aprobaciones o a dificultades del proceso administrativo.

Como propuesta de mejora, plantearía las siguientes acciones:

1. Medir el indicador durante uno o dos meses para establecer una línea base y comprender el comportamiento real.
2. Definir un procedimiento formal para las compras urgentes, con una justificación registrada y las aprobaciones correspondientes.
3. Evaluar umbrales de valor que permitan determinar cuándo se requiere una aprobación adicional.
4. Presentar reportes mensuales por área y centro de costo para facilitar el seguimiento y la toma de decisiones.
5. Revisar los casos recurrentes para identificar oportunidades de simplificación del proceso de solicitud y aprobación.

La decisión de permitir, restringir o rechazar las órdenes retroactivas debe corresponder a la dirección y a los responsables del proceso. El agente debe identificar, registrar y comunicar la excepción, no establecer por su cuenta una política administrativa.

## 8. Decisiones y trade-offs

### 1. Releer los datos desde los archivos de origen

Se priorizó que las herramientas consulten nuevamente los datos de los archivos de entrada, en lugar de confiar únicamente en los valores de `paquete`, `derivados` o `payload` enviados por el modelo.

La razón es que los montos, los datos del proveedor y las condiciones de creación deben validarse con información controlada por el sistema. De esta forma, un error de interpretación del modelo no debería modificar directamente los valores utilizados para construir la orden de compra.

El costo de esta decisión es realizar lecturas adicionales de archivos, aunque para el volumen esperado del reto se considera una alternativa razonable. Los argumentos de las herramientas se mantienen de acuerdo con el contrato definido, pero la lógica de negocio determina cuáles son las fuentes confiables.

### 2. Controlar la confirmación desde el código

La confirmación humana se controla desde la lógica de ejecución y no únicamente mediante instrucciones en el prompt.

Esta decisión busca evitar que una respuesta incorrecta del modelo permita crear una orden sin autorización. El sistema debe verificar el estado de confirmación antes de ejecutar una operación que lo requiera.

### 3. Utilizar `fetch` en el adaptador de OpenAI

Se optó por realizar las solicitudes HTTP directamente mediante `fetch`, en lugar de incorporar el SDK oficial.

La ventaja es mantener un adaptador pequeño y controlar explícitamente las solicitudes, los tiempos de espera y el tratamiento de errores. Como contrapartida, el proyecto debe mantener correctamente el formato de las solicitudes y respuestas de la API, así como la interpretación de los errores y del consumo de tokens.

### 4. Mantener sesiones en memoria

Se utilizaron sesiones en memoria y archivos de salida para mantener el alcance del reto acotado y evitar introducir una base de datos adicional.

Esta alternativa simplifica el despliegue, pero implica que un reinicio puede provocar la pérdida de sesiones y del estado temporal. Para un entorno productivo sería necesario incorporar persistencia duradera y definir una estrategia de recuperación.

### 5. Extraer los montos mediante lógica determinista

Se optó por utilizar expresiones regulares y funciones de parseo para extraer los montos de los documentos compatibles, en lugar de delegar esa decisión exclusivamente al modelo.

La ventaja es tener un comportamiento verificable y reproducible para los formatos contemplados. La principal limitación es que los parsers pueden requerir ajustes cuando aparecen nuevas estructuras, separadores decimales o formas de representar los valores.

Por este motivo, es importante disponer de casos de prueba para los formatos admitidos y generar errores claros cuando no sea posible interpretar un valor con suficiente certeza.

## 9. Supuestos

Para desarrollar la solución se consideran los siguientes supuestos, que deben validarse con el negocio antes de una implementación productiva:

- El campo `valor_total` de la solicitud incluye IVA y se compara con el total de la cotización.
- La solicitud genera una sola posición, identificada con el número 10 y unidad `UN`, porque el fixture no contiene una unidad explícita.
- La aprobación se reconoce mediante el estado esperado y la verificación del remitente contra el maestro de aprobadores autorizado.
- Los maestros incluidos en los fixtures están completos y vigentes para el alcance del reto.
- Las fechas se encuentran en un formato normalizado que permite compararlas de manera consistente.
- La identificación del proveedor por NIT normaliza los puntos y el dígito de verificación según las reglas definidas.
- Los datos derivados, como el IVA o la condición de pago, deben proceder de fuentes confiables y quedar identificados como valores propuestos cuando corresponda.
- La integración con SAP debe validar los campos obligatorios, las reglas contables y las autorizaciones propias de la instalación.

Estos supuestos delimitan el comportamiento esperado de la solución y sirven como base para definir casos de prueba adicionales.

## 10. Cobertura

La cobertura debe confirmarse mediante la ejecución de `demo.ts` con los fixtures del proyecto y la revisión de los resultados obtenidos. La siguiente tabla recoge el estado descrito en el diseño inicial y los principales puntos pendientes de validar.

| Historia | Estado reportado | Qué falta para producción |
|---|---|---|
| HU-1. Leer paquete | Implementación reportada; pendiente de comprobar con los fixtures. | Lectura de archivos `.xlsx` y PDF reales. La herramienta `oc_leer_excel` debe verificarse o implementarse si aún no existe. |
| HU-2. Validar | Implementación reportada; pendiente de comprobar todas las reglas. | Consultar maestros vigentes desde SAP y verificar los casos excepcionales. |
| HU-3. Payload y trazabilidad | Implementación reportada; pendiente de comprobar el payload generado. | Incorporar los campos adicionales requeridos por SAP y validar su correspondencia. |
| HU-4. Evidencia | Parcial según el diseño descrito: archivo `.txt` con SHA-256. | Incorporar el archivo de aprobación en PDF y determinar si se requiere firma digital. |
| HU-5. Crear orden de compra | Creación simulada mediante el adaptador SAP; debe verificarse su idempotencia y el registro en `control.csv`. | Implementar y probar el adaptador SAP real. |
| HU-6. Manejo de errores | Implementación reportada; pendiente de comprobar los escenarios de error. | Ampliar las pruebas con formatos inesperados, errores de conexión y resultados ambiguos. |
| Front, API, logs y límites | Implementación reportada; pendiente de validación integral. | Incorporar autenticación, observabilidad y persistencia adecuada para producción. |
| Bonus `modulo/` | Pendiente de confirmar. | Revisar el alcance del bonus y comprobar si fue implementado. |

El estado definitivo de cada historia debe actualizarse con base en la ejecución real. No se considera suficiente que exista código para dar una historia por terminada: también se deben revisar los resultados, las evidencias y los casos negativos.

## 11. Uso de IA

Durante el desarrollo utilicé Claude como herramienta de apoyo para analizar los requerimientos, organizar la arquitectura y acelerar la construcción de los componentes de la solución. También fue útil para revisar alternativas de implementación, estructurar las reglas del proceso y preparar la documentación técnica.

Mi criterio fue utilizar la IA como apoyo al desarrollo, sin delegarle las decisiones críticas del negocio. En una solución que puede terminar creando órdenes de compra, es importante que los controles de autorización, la validación de valores y la confirmación de las operaciones estén respaldados por código verificable.

**Qué se descartó o cambió:** se priorizó que las herramientas consultaran los datos de origen en lugar de confiar únicamente en la información enviada por el modelo. También se reforzó el control de confirmación humana desde el código, para evitar que el flujo dependa exclusivamente de que el modelo siga las instrucciones del prompt. Otra decisión importante fue mantener la extracción y validación de los valores monetarios bajo reglas deterministas.

**Verificación propia:** la revisión debe enfocarse en ejecutar el proyecto, comprobar el comportamiento de las herramientas y validar los resultados con los fixtures disponibles. También es necesario revisar manualmente los montos extraídos, los datos del proveedor, las aprobaciones y las situaciones que requieren confirmación. Los errores encontrados, los ajustes realizados y los resultados de cada prueba deben registrarse con base en las ejecuciones efectivamente realizadas.

La responsabilidad final sobre la solución no se limita a aceptar el código generado por una herramienta de IA. Es necesario entender su funcionamiento, verificar sus resultados y asegurarse de que las decisiones técnicas respondan a los requisitos del reto.

## 12. Riesgos para producción

| Riesgo | Mitigación |
|---|---|
| El modelo interpreta incorrectamente un dato o presenta un valor equivocado. | Obtener los datos desde fuentes controladas, reconstruir el payload en el código y validar los valores antes de crear la orden. |
| Se omite la confirmación humana. | Controlar la confirmación desde el código y registrar quién autorizó la operación en `excepciones.confirmado_por`, cuando corresponda. |
| La conexión con SAP falla o el resultado de la creación es ambiguo. | Consultar primero por una referencia única, evitar reintentos a ciegas y enviar los casos ambiguos a revisión. |
| Consumo excesivo de tokens o uso no autorizado de la API. | Establecer límites de iteraciones, tokens, longitud de mensajes y sesiones; controlar las cuotas y proteger el acceso al servicio. |
| Aparecen formatos de factura o cotización diferentes a los contemplados. | Ampliar los parsers, validar los datos mediante esquemas y devolver errores claros cuando no sea posible interpretar un documento. |
| La aprobación registrada no constituye evidencia suficiente. | Conservar la trazabilidad y la huella SHA-256, y evaluar la integración con el correo original, los documentos fuente o una firma digital si se requiere. |
| Exposición de datos personales o información confidencial. | Utilizar datos de prueba, proteger las credenciales, limitar el acceso a los registros y revisar las políticas de tratamiento de datos del proveedor del modelo. |
| Se pierde el estado cuando se reinicia el servidor. | Incorporar almacenamiento duradero, recuperación de sesiones y mecanismos de respaldo. |
| Se crean órdenes duplicadas después de un timeout. | Implementar idempotencia con una referencia única y consultar el estado en SAP antes de cualquier nuevo intento. |
| Las reglas de negocio cambian y la solución queda desactualizada. | Mantener las reglas documentadas, versionar los cambios y ejecutar pruebas de regresión antes de liberar nuevas versiones. |

En conclusión, la solución propone reducir la digitación manual y mejorar la consistencia de la información mediante validaciones, automatización y trazabilidad. Para llevarla a producción, el siguiente paso es comprobar integralmente los escenarios de prueba, completar las funcionalidades pendientes y validar la integración con SAP junto con los responsables técnicos y funcionales.
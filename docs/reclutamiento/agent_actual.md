# Agente CV CloudX – Estado actual

## Descripción general
- `runCvAgent` orquesta el flujo para convertir un CV original a la versión CloudX:
  1. Sube el PDF de origen con `openai.files.create`.
  2. Inyecta instrucciones y el PDF adjunto como `input_file`.
  3. Define tres tools disponibles para el modelo:
     - `fill_template_html`: rellena placeholders en el template HTML.
     - `preview_resume_snapshot`: genera una captura (PNG) del HTML y la devuelve en Base64.
     - `export_resume_pdf`: convierte el HTML definitivo en PDF.
  4. Limita a 2 previsualizaciones (snapshot inicial + 1 corrección).
  5. Mantiene logs en formato bullet/indent para cada acción (upload, tool call, etc.).
  6. Limpia archivos temporales y elimina el `file_id` del PDF original al terminar.

## `fill_template_html`
- Nueva tool (`src/tools/fillTemplate.mjs`).
- Recibe `template_path`, `output_html_path`, y `fields`.
- Reemplaza placeholders (`__NAME__`, `__SUMMARY__`, etc.) y genera un HTML de trabajo.

## `preview_resume_snapshot`
- Nueva tool (`src/tools/previewSnapshot.mjs`).
- Usa Puppeteer para renderizar el HTML y capturar un PNG (Base64). 
- El agente adjunta ese PNG como `input_image` (“data:image/png;base64,…”) para que el modelo revise el layout.
- Lleva el conteo `previewCount` y aborta si se supera el máximo.

## `export_resume_pdf`
- Nueva tool (`src/tools/exportPdf.mjs`).
- Convierte el HTML final a PDF con Puppeteer.
- Señala `exportSucceeded=true` cuando termina OK.

## Logging
- Estructura: `• Acción` + `  └ detalle`.
- También se captura el razonamiento del modelo (`model: …`) en cada turno.

## Limpieza de temporales
- `tempFiles`: HTML/PNG generados en el proceso.
- `uploadedFileId`: PDF original subido; se elimina al finalizar.
- No se guardan imágenes en Files API (ahora se utilizan Data URLs).

## Limitaciones conocidas
- El extractor aún no genera los bloques completos de Experience/Languages/Industries/Education como requiere el template final.
- Sólo se permiten 2 previsualizaciones; el modelo debe explicar qué ve mal en cada snapshot para justificar correcciones.
- No hay persistencia de checkpoint; en ejecuciones largas se puede exceder contexto si el modelo insiste en reintentos.


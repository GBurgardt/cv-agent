# Cómo funciona el agente de CV de este repo

Entrada principal
- El comando `bin/cv-agent.mjs` toma el PDF original (`--cv`), el template HTML y la ruta de salida. Carga variables de entorno (`dotenv`) y delega en `runCvAgent` que está en `src/agent.mjs`.

Arranque y contexto
- `runCvAgent` valida que existan el CV y el template, sube el PDF a OpenAI como `user_data` y arma los mensajes iniciales: un prompt de sistema largo con reglas estrictas, un mensaje con rutas sugeridas y el mensaje del usuario con el adjunto.
- El modelo base por defecto es `gpt-5-codex`, y se fija un límite de tokens y un colchón para no reventar el contexto. Si se le va la mano, `trimInputToBudget` va recortando los mensajes más viejos.

Herramientas disponibles
- `fill_template_html`: llena el template HTML con los campos (summary, skills, idiomas, etc.). Usa `src/tools/fillTemplate.mjs` que transforma listas y textos en HTML limpio antes de escribir `resume-working.html`.
- `preview_resume_snapshot`: renderiza el HTML con Puppeteer y saca un JPEG para que el modelo lo revise.
- `export_resume_pdf`: vuelve a levantar el HTML con Puppeteer pero esta vez lo imprime como PDF A4 con márgenes definidos.
- También hay un generador de “insights” (`generateIterationInsight`) que usa el mismo cliente de OpenAI para dar feedback corto entre iteraciones y empujar al modelo a corregir.

Estado y restricciones
- El archivo `src/agent.mjs` lleva un estado interno (`createAgentState`) que controla cuántas previews se usan (solo 1), si ya se hizo el primer llenado del template, si se aplicó la corrección post preview y si la exportación salió bien.
- Con ese estado cada handler valida el flujo: impide un segundo `fill_template_html` antes de haber hecho la vista previa, fuerza a aplicar exactamente una corrección y bloquea la exportación hasta que haya preview y corrección hechas.
- Después de cada tool call se registra qué pasó y se generan mensajes extra cuando hay captura de pantalla (se incrusta el `base64` en un mensaje `input_image`).

Loop de iteraciones
- El agente permite hasta 8 iteraciones. En cada vuelta se manda la conversación actual (`input`) al endpoint `responses.create` con las tools definidas y `tool_choice: "auto"`.
- Si el modelo responde sin tool call, se agrega un recordatorio para que cierre con `export_resume_pdf`.
- Cuando el modelo pide una tool, se ejecuta el handler correspondiente, se captura el resultado y se vuelve a inyectar al chat como `function_call_output`. Si se genera un preview, se dispara un insight con `generateIterationInsight`.
- El loop corta cuando `export_resume_pdf` devuelve OK. Antes de salir se comprueba que el PDF exista; si algo falló se informa el error acumulado.

Limpieza final
- Siempre que termina se borra el archivo subido a OpenAI y cualquier captura temporal para no dejar basura en disco ni archivos huérfanos en la cuenta.

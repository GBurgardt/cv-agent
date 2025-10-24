# Cómo funciona el agente de CV de este repo

Entrada principal
- El comando `bin/cv-agent.mjs` recibe la ruta del PDF (`--cv`), la del template DOCX y la de salida. Carga variables de entorno (`dotenv`) y delega en `runCvAgent` (`src/agent.mjs`).

Arranque y contexto
- `runCvAgent` valida la existencia del CV y del template, sube el PDF a OpenAI como `user_data` y arma los mensajes iniciales: prompt de sistema con reglas claras, recordatorio de rutas sugeridas y mensaje del usuario con el adjunto.
- Se usa `gpt-5-codex` enviando el historial completo; ya no recortamos mensajes en función del presupuesto de tokens.

Herramientas disponibles
- Sólo se expone `fill_docx_template`: recibe `fields` y delega en `src/tools/fillTemplateDocx.mjs` para inyectar datos en el DOCX. El módulo arma strings auxiliares (por ejemplo, bullets y experiencia) y usa Docxtemplater + PizZip para escribir el archivo final.

Loop de iteraciones
- El agente permite hasta 6 iteraciones. Cada vuelta se envía a `responses.create` con `tool_choice: "auto"`.
- Si el modelo llama `fill_docx_template` sin `fields`, el handler levanta un error y la iteración fracasa explícitamente; así el modelo debe reconstruir el payload.
- Cuando la tool responde `ok`, el handler guarda la ruta del DOCX y el loop finaliza.

Limpieza final
- Se borra el PDF subido a OpenAI y cualquier archivo temporal antes de salir; si la tool falló se lanza la excepción correspondiente.

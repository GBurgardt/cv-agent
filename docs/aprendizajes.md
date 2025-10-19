# Aprendizajes recientes (CV Agent)

- Manejo de tokens: la ventana de contexto se saturaba rápido al adjuntar snapshot + historial completo; lo mitigamos estimando tokens y recortando mensajes viejos antes de cada turno. Falta una métrica real para monitorear cuánto consumimos por run.
- Flujo de vista previa: permitir una sola preview obligó a que el agente documente la corrección y exporte enseguida; reduce el riesgo de loops pero nos deja sin verificación extra si la segunda pasada falla, así que hay que revisar bien la snapshot antes de continuar.
- Template completo: el HTML original ignoraba sections clave (Skills/Industries/Education/Experience) y ocupaba dos páginas; rediseñar el layout y exigir que el agente rellene todas las claves nos ayudó a detectar huecos en la extracción (todavía falta poblar algunos campos en los datos de origen).
- Snapshot en contexto: guardar la imagen en base64 dentro del output de la tool duplicaba el payload y reventaba la ventana. Ahora el `preview_resume_snapshot` devuelve un objeto sin `image_base64`, pero igual enviamos la captura como mensaje `user` para que el agente la lea. Ese mensaje permanece en el historial hasta que el recortador de contexto lo elimine cuando se agota el presupuesto; la diferencia es que ya no queda almacenado dos veces ni se conserva si necesitamos podar turnos viejos.
- Conversión a documento editable: mantener el layout en DOCX requiere elegir la herramienta correcta. LibreOffice headless convierte el PDF perfecto a DOCX casi sin pérdidas (pero hay que instalarlo). Las librerías Node (`html-to-docx`, `html-docx-js`) funcionan si simplificamos el HTML y estilos; para máxima fidelidad sin instalaciones también existen servicios SaaS (Aspose/ConvertAPI), aunque dependen de la red y costos.\*\*\*

---

codex resume 0199ead4-5c43-7163-afbf-73815f92fc0d

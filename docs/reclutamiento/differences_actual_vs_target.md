# Información que generamos vs. lo que falta

## Datos que hoy extrae el agente
- Resumen (texto para la sección Summary).
- Skills principales (aunque no siempre los deduplica ni prioriza).
- Name y Role.

## Datos que el proceso manual agrega y nosotros aún no
- Languages: lista de idiomas con nivel (Native/Bilingual, Professional Working, etc.).
- Key Industries Served: sectores o industrias derivados de la experiencia (Telecom, Payments, Oil & Gas,…).
- Education: entradas estructuradas con institución + título + período.
- Experiencia detallada con bullets y “Tech:” específico por empleo (en el manual se arma rol por rol con bullet points y tecnologías usadas).

## Gaps actuales del agente
- No clasifica industrias ni arma lista explícita de sectores.
- No extrae/normaliza idiomas con nivel.
- Education se entrega en bloque de texto; falta formatear entradas.
- Bullets de experiencia: se generan, pero sin estructura por compañía ni “Tech:” final.

## Próximos pasos para alcanzar el template completo
1. Extender el extractor para capturar por empleo: compañía, rol, fechas, bullets + tecnologías.
2. Generar listas separadas para Languages e Industries.
3. Formatear Education como entradas individuales (institución, título, años).
4. Integrar estos campos en `fill_template_html` respetando los placeholders del template CloudX.


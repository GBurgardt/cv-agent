# Costos y licencias de motores DOCX (Node.js)

## 1. Docxtemplater
- Núcleo open source (MIT) gratuito; suficiente para reemplazar placeholders simples con texto o listas.
- Los módulos avanzados (HTML, imágenes, tablas dinámicas, etc.) son pagos: cada módulo cuesta **500 €/año** según el aviso oficial de precios (junio 2023).  
- Planes bundle: **PRO/PRO-Select 1 250 €/año** (incluye 4 módulos a elección) y **Enterprise 9 000 €/año** con todos los módulos y soporte prioritario ([pricing](https://docxtemplater.com/pricing/), [blog anuncio](https://blog.docxtemplater.com/new-pricing-plans/)).
- Aplicado a nuestro caso (solo reemplazo de campos estilo mail-merge) no hace falta pagar: usamos el paquete libre más `pizzip`.

## 2. docx-templates
- Proyecto open source con licencia MIT y sin planes comerciales conocidos ([npm](https://www.npmjs.com/package/docx-templates)).
- Permite lógica, loops y helpers dentro del DOCX sin costo.
- Para nuestro flujo basta instalar el paquete; no hay cargos adicionales.

## 3. easy-template-x
- Biblioteca MIT, gratuita tanto para uso personal como comercial ([npm](https://www.npmjs.com/package/easy-template-x)).
- El repositorio no ofrece planes pagos; todas las funciones (texto, tablas, imágenes) vienen incluidas.
- En nuestro contexto no hay costos extras.

## 4. docx + patchDocument
- Paquete `docx` (dolanmiu/docx) es MIT y gratuito ([npm](https://www.npmjs.com/package/docx)).
- El uso de `patchDocument` y resto de utilidades no requiere licencias comerciales.
- Costo cero; solo asumir la complejidad adicional de manipular el modelo DOCX manualmente.

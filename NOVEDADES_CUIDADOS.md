# GeoCuidado — ampliación de cuidados

Se conservó el código GPS, buzzer, Firebase, mapa y perímetro. Se añadieron `js/cuidados.js`, las vistas de Cuidados y Responsables y estilos complementarios.

## Cómo instalar
1. Extrae el ZIP y reemplaza los archivos del proyecto web por los incluidos, manteniendo su estructura.
2. Abre el sitio con HTTPS (por ejemplo, GitHub Pages) y entra con tu cuenta Firebase habitual.
3. En «Cuidados y horarios» agrega medicamentos, aseo, caminatas y otras actividades con hora diaria.
4. En «Responsables» registra contactos y usa «Preparar correo» para abrir el cliente de correo y enviarlo manualmente.
5. Deja abierta la página para que funcionen los recordatorios. Las notificaciones del navegador requieren permiso y HTTPS o localhost.

## Límites importantes
- Los recordatorios se comprueban **solo con la página abierta**; no hay servicio de notificaciones en segundo plano.
- Los correos **no se envían automáticamente**. El enlace mailto requiere que el usuario envíe el correo en su aplicación.
- El perímetro se sigue evaluando desde la web abierta, como en la versión original. No equivale a vigilancia permanente en un servidor.
- Para avisos automáticos reales a responsables, implementar un backend (p. ej. Cloud Functions + proveedor de correo/SMS/WhatsApp), autorización y consentimiento.
- La agenda se repite diariamente y utiliza la zona horaria del dispositivo donde está abierto el navegador.
- El buzzer y la ubicación dependen del hardware, cobertura GPS y conectividad; no sustituye supervisión humana.
- Protege el acceso y restringe la lectura de datos de salud y ubicación a personas autorizadas.

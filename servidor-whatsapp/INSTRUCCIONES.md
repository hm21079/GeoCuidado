# GeoCuidado — WhatsApp desde tu PC (sin Blaze)

## Instalación en Windows / VS Code

1. Instala Node.js LTS (versión 20 o superior).
2. Abre la carpeta `GeoCuidado` en VS Code y abre Terminal > Nuevo terminal.
3. Ejecuta `cd servidor-whatsapp`.
4. Ejecuta `Copy-Item .env.example .env` en PowerShell.
5. Abre `.env` y completa: FIREBASE_API_KEY (de `js/app.js`), URL de Firebase, correo y contraseña **de una cuenta Firebase Authentication autorizada a leer la base**, token NUEVO de Meta y Phone Number ID.
6. Para comprobar el acceso y leer alertas sin enviar WhatsApp, ejecuta `npm start`. Deja la terminal abierta. La primera ejecución crea una línea base y NO envía alertas antiguas.
7. Configura `WA_TEST_TO` con el número de WhatsApp que autorizaste en Meta. Ejecuta `npm run test:whatsapp`: envía la plantilla de prueba `hello_world` sin depender de Firebase.
8. En Meta, crea y espera aprobación de `geocuidado_alerta` (2 variables en el cuerpo) y `geocuidado_cuidado` (4 variables en el cuerpo), idioma español `es`. Si el idioma aprobado es otro, modifica `WA_TEMPLATE_LANG`.
9. En GeoCuidado registra responsables con teléfono salvadoreño y consentimiento de WhatsApp. En modo de prueba Meta solo admite destinatarios de prueba autorizados.
10. Cambia `ENABLE_WHATSAPP=true` y reinicia `npm start`. Prueba un cuidado programado unos minutos después. Luego prueba la salida del perímetro con el ESP32.

## Notas importantes

- NO necesitas desplegar `functions/`, ni activar Firebase Blaze.
- El servidor se ejecuta mientras Windows esté encendido, conectado a internet y Node.js funcionando. Live Server es independiente.
- Node.js accede a Firebase por HTTPS con la cuenta de Firebase Authentication. No uses credenciales de administrador ni una cuenta sin permisos. La cuenta necesita lectura del nodo `dispositivos/gps001` según tus reglas de seguridad.
- `.env` y `.estado-local.json` son PRIVADOS y están ignorados por Git. Nunca los publiques.
- El token temporal de Meta expira: para uso continuo necesitas un token apropiado y permisos oficiales.
- Meta puede cobrar mensajes de plantillas en producción. El número de prueba solo sirve para pruebas limitadas.
- No garantiza entrega: una respuesta exitosa significa que Meta aceptó la solicitud. Los estados finales se verifican mediante webhooks (no incluidos).
- Evita iniciar dos copias del servidor al mismo tiempo. Si cambias de equipo, copia también `.estado-local.json` para evitar reenvíos.
- Para evitar duplicados, las alertas de perímetro se calculan en el servidor a partir del GPS, y no se reenvían las alertas equivalentes generadas por el navegador.
- La primera lectura solo establece la línea base y no envía eventos anteriores. Si un evento ocurre mientras la PC está apagada, puede no enviarse al volver a encender.
- Este prototipo NO debe considerarse un sistema de seguridad de vida crítica sin monitoreo, pruebas y redundancia.

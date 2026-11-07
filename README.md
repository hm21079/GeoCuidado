# GeoCuidado — conectado a RastreadorGPS

1. Abre la carpeta con VS Code y usa Live Server (no abras el HTML directamente como archivo).
2. Inicia sesión con el usuario creado en Firebase Authentication. No se guardan contraseñas en el código.
3. Elige en Ajustes «Dispositivo ESP32 (Firebase)»; viene seleccionado por defecto.
4. La aplicación consulta `dispositivos/gps001` cada 3 segundos y usa `latitud`, `longitud`, `satelites`, `altitud`.
5. Las reglas de Realtime Database deben permitir a ese UID leer esa ruta. No uses reglas públicas.
6. Configuración del paciente, contactos, recordatorios e historial se guardan **localmente en el navegador**, no en Firebase. No se sincronizan entre celulares.
7. Si el ESP32 no envía un campo `timestamp`/`t` en milisegundos, la aplicación no puede confirmar cuándo reportó por última vez: «En línea» indica lectura disponible, no presencia real.
8. Las alertas por Telegram, SMS o correo abren enlaces para enviarlas manualmente; no se envían automáticamente.
9. `firmware/enviar_firebase.ino` es un ejemplo antiguo, NO lo cargues: escribe en `/ubicacion` y no usa la autenticación actual. Conserva tu sketch ESP32 que ya devuelve HTTP 200.

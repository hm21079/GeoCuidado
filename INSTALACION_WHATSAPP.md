# GeoCuidado + WhatsApp

1. Se requiere Firebase Blaze para desplegar Functions y Cloud Scheduler. Spark permite conservar el código, pero no desplegarlo.
2. Crea plantillas aprobadas `geocuidado_alerta` (2 parámetros) y `geocuidado_cuidado` (4 parámetros), idioma `es`.
3. Configura número de producción de WhatsApp y token de sistema; el número de prueba tiene restricciones.
4. En la raíz del proyecto ejecuta `firebase login`, luego `cd functions`, `npm install`, `cd ..`.
5. Ejecuta `firebase functions:secrets:set WA_TOKEN` y `firebase functions:secrets:set WA_PHONE_ID`.
6. Ejecuta `firebase deploy --only functions`.
7. Registra el consentimiento de cada responsable desde el formulario. Los registros anteriores quedan sin autorización por defecto.
8. El detector servidor escucha `dispositivos/gps001/timestamp`, que actualiza el firmware principal ESP32 al publicar coordenadas.
9. Los avisos se generan desde el servidor. La web conserva notificaciones internas. Para fiabilidad de emergencia se requieren pruebas de cobertura, batería y recepción.
10. Meta acepta mensajes antes de confirmar su entrega. Para rastrear entregas hace falta configurar webhooks de estado.

**Seguridad:** el token temporal mostrado en capturas debe regenerarse. No subir credenciales al repositorio.

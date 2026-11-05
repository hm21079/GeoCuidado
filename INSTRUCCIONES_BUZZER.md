# GeoCuidado: buzzer manual y geocerca

1. Conecta el buzzer pasivo de bajo consumo: positivo a GPIO25, negativo a GND. Si necesita más corriente, usa transistor y fuente adecuada. Desconecta alimentación antes de cablear.
2. En Firebase Console > Realtime Database > Reglas, pega `REGLAS_FIREBASE.json`. Comprueba que el UID sea exactamente el de tu usuario de Firebase Authentication antes de publicar.
3. En Arduino IDE instala `TinyGPSPlus` y `ArduinoJson` v7. El código utiliza la API LEDC del ESP32 Arduino Core 2.x; selecciona una versión 2.0.x del paquete esp32 o adapta LEDC si usas 3.x.
4. Abre `firmware/GeoCuidado_ESP32.ino`. En `firmware/credenciales.h` configura WiFi, correo y contraseña Firebase de manera privada. No publiques este archivo. La API key del proyecto está incluida; si fue rotada, actualízala.
5. Carga el sketch al ESP32 y abre el monitor serie a 115200.
6. Abre la app en Live Server, inicia sesión, fija zona y pulsa Activar buzzer. En Firebase debe aparecer `dispositivos/gps001/control/buzzerManual: true` y luego `estado/buzzerEncendido: true`.
7. Al salir del radio con GPS válido y margen de 15 metros, sonará incluso sin la app abierta. Regresando dentro del radio menos 15 m se apagará, salvo que el encendido manual continúe activo.

Importante: el dispositivo debe tener energía y WiFi para órdenes remotas. La geocerca funciona con la última zona recibida, incluso si pierde WiFi, mientras el ESP32 siga encendido y el GPS tenga señal. No se debe usar como único sistema de protección personal. No publiques credenciales en repositorios. Cambia las contraseñas previamente compartidas.

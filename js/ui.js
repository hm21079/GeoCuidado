// ==================================================
// GEOCUIDADO - DETALLES DE INTERFAZ
//
// No modifica la lógica de Firebase ni del GPS.
// Solo observa los textos que ya escribe app.js
// y marca el estado (data-estado) para que el CSS
// pinte los colores correspondientes.
// ==================================================

(function () {

  const $ = id => document.getElementById(id);

  // Ejecuta una función cada vez que cambia el texto de un elemento.
  function observar(id, fn) {

    const nodo = $(id);
    if (!nodo) return;

    const aplicar = () =>
      fn(nodo.textContent.trim().toLowerCase(), nodo);

    new MutationObserver(aplicar).observe(nodo, {
      childList: true,
      characterData: true,
      subtree: true
    });

    aplicar();
  }

  // Estado del dispositivo: dentro / fuera / esperando.
  observar("estadoGPS", texto => {

    const estado =
      texto.includes("fuera") ? "fuera" :
      texto.includes("dentro") ? "dentro" :
      "espera";

    $("statusCard").dataset.estado = estado;
  });

  // Mensaje de la protección perimetral.
  observar("zonaEstado", (texto, nodo) => {

    nodo.dataset.estado =
      texto.includes("alerta") ? "fuera" :
      texto.includes("dentro") ? "dentro" :
      "espera";
  });

  // Estado de la conexión con Firebase.
  observar("conexion", (texto, nodo) => {

    nodo.dataset.estado =
      texto.includes("recibidos") ? "ok" :
      (texto.includes("error") || texto.includes("sin datos"))
        ? "error"
        : "espera";
  });

  // Estado del buzzer.
  observar("buzzerEstado", (texto, nodo) => {

    nodo.dataset.estado =
      texto.startsWith("comando: activar") ? "on" :
      texto.startsWith("comando: desactivar") ? "off" :
      "";
  });

  // Al cambiar de sección, volver arriba (útil en celular).
  document.querySelectorAll(".nav").forEach(boton => {
    boton.addEventListener("click", () => {
      window.scrollTo({ top: 0 });
    });
  });

})();

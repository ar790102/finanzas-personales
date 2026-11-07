# Finanzas personales (fase 1)

App web instalable. Los datos se guardan cifrados (AES-256-GCM, clave derivada de tu
contraseña con PBKDF2-SHA256, 600.000 iteraciones) solo en el dispositivo donde la usás.
El servidor donde se aloja solo tiene el programa, nunca tus datos.

## Probarla en la computadora
Abrí `index.html` con Chrome o Edge. Todos los archivos tienen que estar en la misma carpeta (incluidos `chart.umd.js`, que dibuja los gráficos, y `pdf.min.mjs` y `pdf.worker.min.mjs`, que leen las facturas). La importación de PDF solo funciona con la app publicada (https), no abriendo el archivo directamente. Funciona, pero no se instala ni trabaja sin conexión.

## Publicarla para usarla también en el celular (GitHub Pages, gratis)
1. Creá una cuenta en github.com y un repositorio nuevo (por ejemplo `finanzas`).
2. "Add file" → "Upload files" y subí todos los archivos de esta carpeta.
3. Settings → Pages → Source: "Deploy from a branch", rama `main`, carpeta `/ (root)`.
4. A los minutos queda en `https://TU-USUARIO.github.io/finanzas/`.

## Instalarla
- iPhone: abrí la dirección en Safari → Compartir → "Agregar a inicio".
- Android: abrila en Chrome → menú ⋮ → "Instalar app".
- Computadora: en Chrome/Edge, ícono de instalar en la barra de direcciones.

Usá siempre la app instalada: en iPhone tiene un almacenamiento separado del de Safari.

## Pasar los datos entre dispositivos
En la computadora: Seguridad y backup → Descargar backup. Pasá el archivo al celular
(Drive, iCloud, mail) y en la pantalla inicial del celular elegí "Restaurar backup".

## Actualizar a una versión nueva
Reemplazá los archivos en el repositorio y cambiá el número de `CACHE` en `sw.js`.
La app toma la versión nueva la segunda vez que la abrís.

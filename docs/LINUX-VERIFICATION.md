# Verificación del port Linux

Fecha: 2026-10-23. Versión Linux 1.1.8, basada en el último upstream `73329b0a801f08a6d44a9e2d26ce17b75bdc1a81` (2026-10-21) más lo aprovechable de la rama `linux` upstream (`f2981b6`). Compilada desde un clon limpio del repositorio.

## Entorno

Ubuntu 24.04.5 x86_64 dentro de WSL, Node.js 22.23.3, Electron 41 y Xvfb. Flatpak 1.18.4 con runtime y Electron BaseApp 25.08. Las pruebas gráficas usan un D-Bus de sesión temporal.

## Comprobaciones

- 20 pruebas automatizadas aprobadas (incluye selección de Proton y lanzamiento de `.exe` con prefijo propio): argumentos y entradas `.desktop`, detección de Steam/emuladores, almacenamiento, batería, Wine, botones evdev, ciclo real de procesos y control real de un reproductor MPRIS de prueba y servidor HTTP de interfaz con puerto dinámico/fallback ante puerto ocupado.
- `npx tsc --noEmit` aprobado.
- Backend CommonJS y exportación web compilados.
- Los dos paquetes se prueban con `scripts/smoke-linux.cjs`: interfaz, preload, carga de una imagen por `local-file://` desde una ruta absoluta con espacios, backend HTTP, programas, almacenamiento, error ante un ejecutable inexistente y apertura/retorno de un proceso externo.
- La prueba de AppImage utiliza extracción automática, porque este entorno no proporciona FUSE.
- En Flatpak la imagen de prueba debe estar en una carpeta concedida (`SMOKE_LOCAL_FILE_DIR`), porque el sandbox no ve el `/tmp` del host.
- La prueba de Flatpak instala el bundle en un directorio de instalación de prueba y abre el proceso externo mediante el puente de host. Ambos formatos detectaron un acceso `.desktop` temporal de usuario; el Flatpak mostró 6 programas y la AppImage 5 en este entorno.

Los paquetes, `SHA256SUMS`, las capturas y reportes `appimage-smoke.*` y `flatpak-smoke.*` quedan en `frontend/dist-electron/`, fuera del control de versiones. El proceso de prueba usa `--no-sandbox` únicamente porque corre como root; ese argumento no se agrega a los lanzadores de los paquetes.

## Pendiente de validar en hardware real

Arch y Void (glibc/musl), sesiones Wayland, foco del overlay durante juegos, mandos físicos, Bluetooth, aceleración GPU, Steam/Proton, Heroic y cada emulador. Las funciones en línea necesitan las credenciales y servicios correspondientes. La compilación y estas pruebas no garantizan que todo juego o escritorio funcione igual.

La guía de instalación, permisos y compilación está en [LINUX.md](LINUX.md). Los paquetes se distribuyen mediante GitHub Releases de este fork. No se han publicado en Flathub.

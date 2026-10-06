# WPS5 Linux

Este fork conserva la interfaz de FifthStation y agrega integración Linux al launcher. Los paquetes son para **x86_64**. El launcher no incluye emuladores, ROMs, BIOS, Steam, Wine ni Proton: utiliza las instalaciones del usuario.

## Instalar

### AppImage

```sh
chmod +x WPS5-Linux-1.1.5-x86_64.AppImage
./WPS5-Linux-1.1.5-x86_64.AppImage
```

Si no tienes FUSE, puedes extraer y ejecutar el contenido:

```sh
./WPS5-Linux-1.1.5-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

AppImage utiliza el Electron Linux oficial y requiere glibc y las bibliotecas gráficas compatibles. Arch, Void con glibc y distribuciones equivalentes son objetivos del port. **Void con musl debe utilizar Flatpak**, que proporciona su propio runtime. Una AppImage no convierte binarios glibc en binarios musl. En equipos donde no esté habilitado el sandbox de Chromium mediante espacios de nombres de usuario, usa Flatpak.

### Flatpak

Requiere **Flatpak 1.16 o posterior**, porque el paquete pide acceso específicamente a dispositivos de entrada con `--device=input`. La base y el runtime son Freedesktop/Electron 25.08.

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08
flatpak install --user ./WPS5-Linux-1.1.5-x86_64.flatpak
flatpak run io.github.xXKuroiKenshiXx.WPS5Linux
```

El bundle es instalable localmente. La publicación en Flathub requiere un proceso de revisión separado.

## Juegos y emuladores

- Agregar Juego detecta archivos `.desktop` de aplicaciones de usuario, sistema y exportaciones Flatpak. Respeta entradas ocultas y nombres localizados.
- Examinar acepta ejecutables Linux sin extensión, scripts ejecutables y AppImages. El archivo debe tener permiso de ejecución. Los argumentos se pasan como una lista, conservando rutas con espacios; no se interpreta una línea de shell automáticamente.
- Steam se detecta en `~/.steam`, `~/.local/share/Steam`, XDG y la instalación Flatpak. Se leen las bibliotecas adicionales de `libraryfolders.vdf`. Steam decide cuándo usar Proton.
- Heroic/Legendary se detecta desde sus registros de juegos instalados. El lanzamiento usa Heroic; el cliente debe estar instalado y registrar su protocolo.
- Los `.exe` manuales requieren Wine disponible en el host. Para juegos de Windows con Proton, usa la entrada de Steam o el acceso `.desktop` de tu gestor. Los `.lnk` y `.bat` de Windows deben sustituirse por accesos o ejecutables Linux.
- DuckStation, PCSX2, RPCS3, PPSSPP, Dolphin, RetroArch y Ryujinx/Eden se buscan en PATH, accesos `.desktop`, Flatpak y AppImages ejecutables en ubicaciones habituales. Si no se detectan, elige el ejecutable manualmente. Cada emulador conserva sus requisitos propios de BIOS, firmware, cores y drivers.
- Las ROMs conservan mayúsculas/minúsculas y se guarda su ruta por separado de los argumentos. Los trofeos RPCS3 usan la carpeta que contiene `dev_hdd0`, normalmente `~/.config/rpcs3` o los datos de su Flatpak, en vez de asumir que viven junto al ejecutable.
- Los logros locales admiten los archivos existentes del proyecto y rutas de datos nativas, Wine y prefijos Proton de Steam. Los registros de logros compatibles de Wine se leen como datos de texto. La disponibilidad real depende del formato y del juego.

## Escritorio, multimedia y mandos

El launcher mantiene perfiles, biblioteca, metadatos, temas, wallpapers, música, vídeos, capturas y funciones en línea. El control de reproducción de otras aplicaciones usa MPRIS sobre el D-Bus de sesión; el reproductor debe publicar MPRIS.

La navegación utiliza la Gamepad API de Chromium. El atajo del overlay durante un juego usa evdev y las combinaciones configuradas. La sesión necesita permiso de lectura del dispositivo `/dev/input/event*` del mando. La batería PlayStation se lee desde `/sys/class/power_supply`, sin cambiar el modo HID del dispositivo. Ninguna de estas lecturas concede permisos del sistema automáticamente.

X11 admite los atajos de teclado de Electron. En Wayland se activa GlobalShortcutsPortal; su disponibilidad y la posición/foco de ventanas superpuestas dependen del compositor y de su implementación del portal. Prueba estos comportamientos en el escritorio objetivo.

Flatpak concede permisos específicos para audio, GPU, dispositivos de entrada, aplicaciones y bibliotecas conocidas. La ejecución de juegos/emuladores externos y la detección de procesos utilizan `flatpak-spawn --host`, autorizado mediante `org.freedesktop.Flatpak`. Esto es parte necesaria de un launcher y debe mantenerse explícito en sus permisos.

Para bibliotecas adicionales en discos externos o una carpeta de ROMs personalizada, concede únicamente esa ruta:

```sh
flatpak override --user --filesystem=/ruta/a/mi/biblioteca:ro io.github.xXKuroiKenshiXx.WPS5Linux
```

Los selectores de archivos usan los portales del escritorio cuando están disponibles. Los datos propios del Flatpak quedan dentro de `~/.var/app/io.github.xXKuroiKenshiXx.WPS5Linux`. El AppImage usa los directorios XDG de Electron. Las consultas de actualizaciones apuntan a las releases de este fork.

## Compilar

En Linux: Node.js 22 o posterior, npm, las bibliotecas de ejecución de Electron y, para Flatpak, Flatpak >=1.16, flatpak-builder y Flathub.

```sh
npm ci --prefix backend
npm ci --prefix frontend
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 org.electronjs.Electron2.BaseApp//25.08
cd frontend
npm run electron:build:linux
```

También existen `electron:build:appimage` y `electron:build:flatpak`. Los archivos se generan en `frontend/dist-electron/`. El paso `desktop:deps` prepara un paquete de ejecución separado: Expo/React se exportan a archivos estáticos y no se incluyen como dependencias del proceso principal. El backend se compila como CommonJS y se incluye sin archivos `.env`.

## Verificar

```sh
cd frontend
dbus-run-session -- npm run test:linux
npx tsc --noEmit
npm run test:smoke:linux
```

La prueba de arranque necesita Xvfb, xauth y un paquete ya generado. Comprueba interfaz/preload, backend, almacenamiento, programas y lanzamiento/retorno de un proceso de prueba. Genera una captura, un log y un reporte JSON en `dist-electron`. Si se ejecuta como root, `--no-sandbox` se usa exclusivamente en ese proceso de prueba.

El workflow `.github/workflows/linux.yml` compila ambos formatos, verifica tipos y comportamiento y conserva paquetes, checksums y evidencia de arranque como artifacts de GitHub Actions.

Las verificaciones locales se realizan en Ubuntu 24.04 bajo WSL con Xvfb y un D-Bus de prueba. Esto permite comprobar compilación y arranque, pero **no demuestra compatibilidad total de todos los juegos, mandos físicos, GPU y compositores en todas las distribuciones**. Quedan las pruebas de escritorio real en Arch/Void, Wayland, Steam/Proton, Heroic y los emuladores elegidos.
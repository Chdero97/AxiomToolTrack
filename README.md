# ToolTrack Kiosco

Aplicación web local para administrar herramental, controlar entradas y salidas, programar mantenimiento preventivo y conservar la trazabilidad completa.

## Funciones incluidas

- Alta y edición de herramentales.
- Tipos de herramental con checklist reutilizable.
- Frecuencia individual en días, semanas o meses.
- Alertas de mantenimiento vencido, del día y próximo a vencer.
- Bloqueo automático de salida cuando el mantenimiento está vencido.
- Entrega a piso con línea, solicitante, orden y observaciones.
- Regreso a Tool Crib con condición del equipo.
- Ejecución de mantenimiento con checklist y evidencia por punto.
- Un punto no conforme mantiene el herramental bloqueado en mantenimiento.
- Baja controlada a scrap, sin perder el historial.
- Trazabilidad de alta, edición, movimientos, mantenimiento y scrap.
- Respaldo/restauración JSON y exportación de inventario CSV.
- Datos guardados localmente en el navegador de la computadora kiosco.

## Inicio rápido en Windows

### Opción 1: modo kiosco

1. Instala [Node.js LTS](https://nodejs.org/) una sola vez.
2. Extrae esta carpeta en una ubicación permanente, por ejemplo `C:\ToolTrack`.
3. Haz doble clic en `INICIAR_KIOSKO.bat`.
4. Microsoft Edge se abrirá a pantalla completa. Mantén abierta la ventana del servidor.
5. Para salir del kiosco usa `Alt + F4`. Para detener el servidor presiona `Ctrl + C` en su ventana.

### Opción 2: desde Visual Studio Code

1. Abre esta carpeta en Visual Studio Code.
2. Abre una terminal integrada.
3. Ejecuta `npm start`.
4. Abre `http://localhost:8080` en Edge o Chrome.

También puede utilizarse la extensión **Live Server** sobre `index.html`.

## Primer uso recomendado

1. En el primer inicio, crea el usuario y contraseña del administrador.
2. En **Configuración → Usuarios y accesos**, registra las cuentas y asigna su perfil.
3. En **Configuración**, cambia el nombre de planta/área.
4. En **Tipos y checklists**, crea las familias de herramental y sus puntos de mantenimiento.
5. En **Herramentales**, da de alta cada activo, su frecuencia y fecha base.
6. Prueba una salida, un regreso y un mantenimiento.
7. Genera el primer respaldo JSON.

La sección **Datos de demostración** agrega ejemplos para conocer el flujo. Úsala antes de capturar información real.

## Perfiles de acceso

- **Administrador:** acceso completo; puede dar de alta usuarios de cualquier perfil.
- **Ingeniero:** acceso completo a la operación, configuración y respaldos; no puede dar de alta usuarios.
- **Técnico:** consulta inventario, tipos, movimientos y trazabilidad; puede dar de alta herramentales, registrar entradas/salidas y realizar mantenimientos. No puede editar o dar de baja herramentales ni modificar tipos/configuración.
- **Operador:** solo consulta; no puede ejecutar cambios ni registrar movimientos o mantenimientos.

La sesión solicita usuario y contraseña al abrir la aplicación. Las contraseñas se guardan como hashes en el navegador y las cuentas son locales a ese navegador/perfil; no se incluyen en los respaldos de inventario.

## Dónde se guardan los datos

Los registros se guardan en `localStorage` del navegador. Esto es adecuado para una sola computadora tipo kiosco y no requiere internet ni base de datos.

Importante:

- Usa siempre el mismo navegador, perfil y dirección (`http://localhost:8080`).
- El inicio de sesión y los perfiles son controles locales de la interfaz, no sustituyen autenticación de servidor: alguien con acceso al navegador, a las herramientas de desarrollo o al perfil de Windows puede acceder a los datos locales.
- Para controles de acceso resistentes entre usuarios o computadoras, se requiere un backend con autenticación y permisos del lado del servidor.
- Borrar los datos del navegador también elimina los registros locales.
- Exporta un respaldo JSON diariamente o después de cambios importantes.
- Guarda los respaldos fuera de esta carpeta, idealmente en una unidad de red controlada.
- Si se requiere acceso simultáneo desde varias computadoras, usuarios con contraseña o notificaciones con la app cerrada, será necesario agregar un backend y una base de datos.

## Notificaciones

Las alertas visuales del tablero funcionan siempre. Las notificaciones del navegador son opcionales y muestran un resumen diario mientras la aplicación se encuentre abierta. Actívalas en **Configuración** y autoriza el permiso en Edge/Chrome.

## Archivos principales para editar

- `index.html`: estructura de pantallas.
- `styles.css`: diseño, colores y adaptación de tamaño.
- `app.js`: reglas del negocio, datos y acciones.
- `server.js`: servidor local sin dependencias externas.

## Respaldo antes de modificar

Antes de editar el código o mover la carpeta, entra a **Configuración → Exportar respaldo JSON**. Después de cualquier cambio, prueba altas, salidas, regresos, bloqueo por vencimiento y mantenimiento con un registro de demostración.

# Metro-ON — Plataforma de Mantenimiento (PWA)

Aplicación web progresiva (**PWA**) desarrollada para la Subgerencia de Mantenimiento de Peajes y Equipos de **Metro de Santiago** (Grupo 9 — Design Thinking).

## Funcionalidades principales (Iteración 2)
- **Autenticación con Supabase (`Auth` + `metro_profiles`)**: creación de cuenta, inicio de sesión, recuperación de contraseña y cambio entre rol **Contratista** y **Supervisor Metro (ITC)**.
- **Identificación rápida del equipo**: escaneo de código **QR** (con cámara `BarcodeDetector` + códigos rápidos) o captura de **N° de serie** para autocompletar estación y activo.
- **Captura por voz + Borrador IA editable**: grabación de audio con transcripción en vivo (`es-CL`), edición manual de diagnóstico preliminar y trabajo sugerido, y fotografías **Antes / Después** ampliables.
- **Piezas utilizadas e inventario en tiempo real**: descuento automático en `metro_inventory` y alertas visuales de stock bajo.
- **Estado de revisión**: `En revisión`, `Pendiente (faltan materiales)` y `Finalizado`.
- **Comentarios específicos de Metro** en cada reporte (`metro_report_comments`).
- **Trazabilidad de vida útil y reincidencias** (`metro_assets` + `metro_asset_interventions`).
- **Modo sin conexión (Offline-first)**: almacenamiento en **IndexedDB** + **Service Worker** para trabajar bajo tierra en andenes y sincronizar al recuperar señal.
- **Mini Manual Técnico offline** integrado con guías paso a paso y protocolos de seguridad.

# Imágenes del CMS en Dokploy / VPS

Las imágenes del CMS se escriben dentro del contenedor en:

`/app/uploads/landing`

Para que no se pierdan al reconstruir o actualizar el contenedor, en Dokploy agrega un almacenamiento persistente al servicio backend:

- Tipo: Volume o Persistent Storage
- Mount path del contenedor: `/app/uploads/landing`
- Nombre sugerido: `jaguares_cms_media`

Configura estas variables del backend en Dokploy:

```env
CMS_UPLOADS_DIR=/app/uploads/landing
CMS_MEDIA_BASE_URL=https://api.jaguarescar.com
```

`CMS_MEDIA_BASE_URL` debe ser el dominio público real que sirve el backend. Si el backend usa otro dominio, reemplázalo.

## Base de datos

Antes de desplegar el backend, crea un respaldo de la MySQL del VPS y aplica
`migrations/20260901_cms_landing_v2.sql` sobre la base existente. La migración
solo crea tablas `landing_*`; no reemplaza ni elimina alumnos, asistencias,
pagos o usuarios, y tampoco inserta filas en `landing_structure`. No importes
la copia completa de `jaguares_cms_dev` sobre producción.

## Comprobación después del despliegue

1. Entrar al editor administrativo del VPS.
2. Subir una imagen pequeña desde **Biblioteca**.
3. Confirmar que abre en `https://api.jaguarescar.com/uploads/landing/...`.
4. Volver a desplegar el backend.
5. Confirmar que la misma URL continúa funcionando.

Las referencias y metadatos se almacenan en `landing_media` de MySQL. El archivo físico se almacena en el volumen. Ambos deben incluirse en los respaldos del VPS.

Las imágenes subidas en localhost no se copian automáticamente al VPS. Después del despliegue, deben subirse desde el panel de producción o copiarse expresamente al volumen persistente.

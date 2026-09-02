# CMS de la página principal — entorno aislado

Este proyecto trabaja contra una copia independiente:

- Proyecto: `C:\Users\Cris\Desktop\jaguares-cms-dev`
- API: `http://localhost:3003`
- MySQL: `localhost:3308`
- Base: `jaguares_cms_dev`
- Contenedor: `jaguares-mysql-dev`
- Volumen: `jaguares_mysql_dev_data`

El proyecto original y MySQL del puerto `3307` no son utilizados por estos comandos.

## Inicio seguro

1. Iniciar `jaguares-mysql-dev` desde Docker Desktop.
2. En `server/`, ejecutar `npm run migrate:cms` y después `npm start`.
3. En `react/`, ejecutar `npm run dev`.
4. Abrir `http://localhost:5173/admin-landing-editor` e ingresar con un administrador existente de la copia.

La migración se cancela si `.env` no apunta a `jaguares_cms_dev` en el puerto `3308`.

## Flujo editorial

1. Editar menú, portada, títulos, deportes, docentes, galería, sección institucional, contacto o pie de página.
2. Usar **Borrador** para guardar sin afectar la página pública.
3. Revisar la vista previa.
4. Usar **Publicar** solo cuando el contenido esté aprobado.
5. En **Versiones** se puede cargar o volver a publicar una versión anterior.
6. En **Orden** se cambia el orden y la visibilidad de las ocho secciones públicas.

Las imágenes se registran en `landing_media` y se guardan por defecto en `server/uploads/landing`. En Docker o producción, ese directorio debe montarse en un volumen persistente y puede configurarse con `CMS_UPLOADS_DIR`.

## Pruebas

- `npm run test:cms:unit` en `server`: normalización y validación.
- `npm run migrate:cms` en `server`: migración idempotente y protegida.
- `npm run build` en `react`: compilación normal de producción.
- `npm run preview:cms` en `react`: vista previa del contenido compilado con proxy a la API aislada.

## Recuperación

- Un error de contenido se revierte publicando una versión anterior desde **Versiones**.
- Un error de desarrollo se evita regresando a la copia original, que permanece intacta.
- La base de desarrollo se detiene desde Docker Desktop sin afectar la original.
- Antes de cambios grandes, crear un `mysqldump` de `jaguares_cms_dev` o respaldar `jaguares_mysql_dev_data`.

No publicar secretos de `.env` ni incluir `docker-init/*.sql` o `uploads/` en Git.

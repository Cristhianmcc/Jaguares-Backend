# Dockerfile para Jaguares Backend API
FROM node:20-alpine

# Establecer directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --production

# Copiar todo el código fuente del backend
COPY . .

# Directorio que Dokploy/VPS debe montar como volumen persistente
RUN mkdir -p /app/uploads/landing

# Exponer el puerto que usa el backend
EXPOSE 3002

# Variables de entorno por defecto (serán sobreescritas por Dokploy)
ENV PORT=3002
ENV NODE_ENV=production
ENV CMS_UPLOADS_DIR=/app/uploads/landing

# Comando para iniciar la aplicación
CMD ["node", "index.js"]

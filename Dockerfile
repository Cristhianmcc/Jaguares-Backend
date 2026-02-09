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

# Exponer el puerto que usa el backend
EXPOSE 3002

# Variables de entorno por defecto (serán sobreescritas por Dokploy)
ENV PORT=3002
ENV NODE_ENV=production

# Comando para iniciar la aplicación
CMD ["node", "index.js"]

module.exports = {
  apps: [
    {
      name: 'jaguares-backend',
      script: 'index.js',
      instances: 'max',       // usa todos los cores del VPS
      exec_mode: 'cluster',   // modo cluster Node.js
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      },
      // Reinicio automático si crashea
      autorestart: true,
      restart_delay: 1000,
      // Logs (rutas relativas para que funcionen dentro del contenedor)
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};

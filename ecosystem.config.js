// ══════════════════════════════════════════════════════════
//  PM2 Ecosystem — Seis Pimientas
//  Iniciar: pm2 start ecosystem.config.js
//  Guardar: pm2 save && pm2 startup
// ══════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: 'seispimientas-api',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_file: '.env',
      max_memory_restart: '500M',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
    },
  ],
};

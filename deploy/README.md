# 🚀 Deploy — Seis Pimientas

## Estructura

```
deploy/
├── setup-server.sh      → Configuración inicial del VPS (ejecutar 1 vez)
├── deploy.sh            → Deploy manual (cuando no se usa CI)
└── README.md            ← Este archivo

.github/workflows/
└── deploy.yml           → Deploy automático con GitHub Actions
```

## Cómo deployar

### ⚡ Automático (cuando esté configurado)

1. Hacés `git push` a la rama `main` en GitHub
2. GitHub Actions corre tests, migraciones y deploya solo

### 🔧 Manual

```bash
ssh root@seispimientas.com
cd /var/www/seispimientas
git pull origin main
npm ci --omit=dev
node db/migrate.js
cd seispimientas-web && npx vite build && cd ..
cd seispimientas-shop && npx vite build && cd ..
pm2 restart seispimientas-api
```

## Configuración inicial del servidor (1 vez)

```bash
ssh root@seispimientas.com
bash <(curl -s https://raw.githubusercontent.com/gonzadraghi-sys/seispimientas/main/deploy/setup-server.sh)
```

Después completar:
- `.env` con credenciales reales
- `node db/seed.js` si es base nueva
- `pm2 restart seispimientas-api`

## Secrets de GitHub necesarios (para CI/CD)

| Secret | Descripción |
|--------|-------------|
| `DEPLOY_HOST` | IP del servidor |
| `DEPLOY_USER` | Usuario SSH |
| `DEPLOY_KEY` | Clave privada SSH |
| `DEPLOY_PATH` | Ruta del proyecto en servidor |
| `DB_HOST` | Host de PostgreSQL |
| `DB_USER` | Usuario de BD |
| `DB_PASSWORD` | Password de BD |
| `DB_NAME` | Nombre de BD |

## URLs en producción

| Servicio | URL |
|----------|-----|
| Shop (tienda) | `https://seispimientas.com` |
| Admin (dashboard) | `https://admin.seispimientas.com` |
| API | `https://seispimientas.com/api/` |

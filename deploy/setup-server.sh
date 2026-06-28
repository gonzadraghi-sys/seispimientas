#!/bin/bash
# ══════════════════════════════════════════════════════════
#  setup-server.sh — Configuración inicial del servidor
#  Ejecutar UNA SOLA VEZ en el VPS de producción
# ══════════════════════════════════════════════════════════
#  Modo de uso:
#    ssh root@seispimientas.com
#    bash < <(curl -s https://raw.githubusercontent.com/gonzadraghi-sys/seispimientas/main/deploy/setup-server.sh)
# ══════════════════════════════════════════════════════════

set -e

echo "════════════════════════════════════════"
echo "  Setup Seis Pimientas - Servidor"
echo "════════════════════════════════════════"

# 1. Actualizar sistema
echo "→ Actualizando sistema..."
apt update && apt upgrade -y

# 2. Instalar dependencias base
echo "→ Instalando dependencias..."
apt install -y curl git nginx certbot python3-certbot-nginx postgresql postgresql-contrib

# 3. Instalar Node.js 20
echo "→ Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 4. Instalar PM2 globalmente
echo "→ Instalando PM2..."
npm install -g pm2

# 5. Configurar PostgreSQL
echo "→ Configurando PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres psql -c "CREATE USER sp_user WITH PASSWORD 'CAMBIAR_EN_PRODUCCION';"
sudo -u postgres psql -c "CREATE DATABASE seispimientas OWNER sp_user;"

# 6. Clonar repositorio
echo "→ Clonando repositorio..."
cd /var/www
git clone https://github.com/gonzadraghi-sys/seispimientas.git
cd seispimientas
git checkout main

# 7. Crear .env de producción
echo "→ Creando .env (completar credenciales reales)..."
cp .env.example .env
nano .env  # ← Completar manualmente con datos de producción

# 8. Instalar dependencias
echo "→ Instalando npm packages..."
npm install

# 9. Migraciones
echo "→ Ejecutando migraciones..."
node db/migrate.js

# 10. Iniciar con PM2
echo "→ Iniciando aplicación con PM2..."
pm2 start src/server.js --name seispimientas-api
pm2 save
pm2 startup

# 11. Configurar Nginx como reverse proxy
echo "→ Configurando Nginx..."
cat > /etc/nginx/sites-available/seispimientas << 'NGINX'
# ══════════════════════════════════════════════════════
#  Nginx — Seis Pimientas API + Frontend Admin + Shop
# ══════════════════════════════════════════════════════

server {
    listen 80;
    server_name seispimientas.com www.seispimientas.com admin.seispimientas.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name seispimientas.com www.seispimientas.com;

    ssl_certificate     /etc/letsencrypt/live/seispimientas.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seispimientas.com/privkey.pem;

    # Shop (frontend build)
    root /var/www/seispimientas/seispimientas-shop/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API backend
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Imágenes
    location /uploads/ {
        alias /var/www/seispimientas/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

# Admin app (subdominio separado)
server {
    listen 443 ssl http2;
    server_name admin.seispimientas.com;

    ssl_certificate     /etc/letsencrypt/live/admin.seispimientas.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.seispimientas.com/privkey.pem;

    root /var/www/seispimientas/seispimientas-web/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API comparte el mismo backend
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /oauth2/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/seispimientas /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 12. SSL con Let's Encrypt
echo "→ Obteniendo certificados SSL..."
certbot --nginx -d seispimientas.com -d www.seispimientas.com
certbot --nginx -d admin.seispimientas.com

echo ""
echo "════════════════════════════════════════"
echo "  ✅ Servidor configurado"
echo "  Próximos pasos:"
echo "  1. Completar credenciales en .env"
echo "  2. node db/seed.js (datos iniciales)"
echo "  3. pm2 restart seispimientas-api"
echo "════════════════════════════════════════"

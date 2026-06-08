# Seis Pimientas · API Backend

Sistema de gestión integral para Casa de Pastas Seis Pimientas.

## Stack
- **Runtime:** Node.js 18+
- **Framework:** Express 4
- **Base de datos:** PostgreSQL 15+
- **Auth:** JWT (access 8h) + bcrypt (rounds: 12)
- **Validación:** Joi

---

## Instalación

### 1. Clonar y dependencias
```bash
git clone <repo>
cd seispimientas
npm install
```

### 2. Variables de entorno
```bash
cp .env.example .env
# Editá .env con tus valores reales
```

### 3. Base de datos
```bash
# Crear base de datos en PostgreSQL
psql -U postgres -c "CREATE USER sp_user WITH PASSWORD 'tu_password';"
psql -U postgres -c "CREATE DATABASE seispimientas OWNER sp_user;"

# Ejecutar schema
psql -U sp_user -d seispimientas -f db/migrations/001_schema.sql

# Cargar datos iniciales
npm run seed
```

### 4. Iniciar
```bash
npm run dev     # Desarrollo (nodemon)
npm start       # Producción
```

---

## Endpoints

### Auth
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/login` | Iniciar sesión | No |
| POST | `/api/auth/refresh` | Renovar token | No |
| POST | `/api/auth/logout` | Cerrar sesión | JWT |
| GET  | `/api/auth/me` | Datos del usuario actual | JWT |
| POST | `/api/auth/cambiar-password` | Cambiar contraseña | JWT |

### Usuarios
| Método | Ruta | Descripción | Permiso |
|--------|------|-------------|---------|
| GET  | `/api/usuarios` | Listar usuarios | usuarios |
| GET  | `/api/usuarios/:id` | Obtener usuario | usuarios |
| POST | `/api/usuarios` | Crear usuario | adminOnly |
| PUT  | `/api/usuarios/:id` | Actualizar usuario | usuarios |
| POST | `/api/usuarios/:id/reset-password` | Resetear contraseña | adminOnly |
| POST | `/api/usuarios/:id/suspender` | Suspender usuario | adminOnly |

### Sistema
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servidor y DB |

---

## Ejemplo de uso

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"GDRAGHI","password":"nobodycantouchme"}'
```

### Request autenticado
```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

---

## Seguridad implementada
- ✅ Contraseñas hasheadas con bcrypt (rounds configurables, default 12)
- ✅ JWT con expiración + refresh token con rotación
- ✅ Rate limiting en login (10 req/15min por IP)
- ✅ Helmet (cabeceras HTTP seguras)
- ✅ CORS configurado
- ✅ Validación de inputs con Joi
- ✅ Log de accesos completo en DB
- ✅ Transacciones en operaciones críticas
- ✅ Sin revelación de información en errores (producción)
- ✅ Multi-local: cada usuario accede solo a su local asignado

---

## Usuarios iniciales
| Usuario | Rol | Acceso |
|---------|-----|--------|
| GDRAGHI | Administrador | Global |
| DSTRAKY | Gerente de Local | Godoy Cruz |

⚠️ **Cambiá las contraseñas en el primer acceso en producción.**

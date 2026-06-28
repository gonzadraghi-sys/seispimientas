// fix_encrypt_pii.js — Cifra datos PII existentes en la base de datos
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.scryptSync(
  process.env.ENCRYPTION_KEY || 'default-key-change-me-in-production',
  'seispimientas-salt',
  32
);

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let enc = cipher.update(text, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc}`;
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'seispimientas',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function main() {
  console.log('🔐 CIFRANDO DATOS PII EXISTENTES\n');

  // 1. Usuarios
  const users = await pool.query("SELECT id, email, telefono FROM usuarios WHERE email IS NOT NULL OR telefono IS NOT NULL");
  for (const u of users.rows) {
    const emailEnc = u.email && !u.email.includes(':') ? encrypt(u.email) : u.email;
    const telEnc = u.telefono && !u.telefono.includes(':') ? encrypt(u.telefono) : u.telefono;
    if (emailEnc !== u.email || telEnc !== u.telefono) {
      await pool.query('UPDATE usuarios SET email = $1, telefono = $2 WHERE id = $3', [emailEnc, telEnc, u.id]);
      console.log(`  ✓ Usuario ${u.id.substring(0,8)}… cifrado`);
    }
  }
  console.log(`  ${users.rows.length} usuarios procesados`);

  // 2. Clientes
  const clients = await pool.query(
    "SELECT id, email, telefono, direccion, ciudad, codigo_postal FROM clientes WHERE email IS NOT NULL OR telefono IS NOT NULL"
  );
  for (const c of clients.rows) {
    const emailEnc = c.email && !c.email.includes(':') ? encrypt(c.email) : c.email;
    const telEnc = c.telefono && !c.telefono.includes(':') ? encrypt(c.telefono) : c.telefono;
    const dirEnc = c.direccion && !c.direccion.includes(':') ? encrypt(c.direccion) : c.direccion;
    const cityEnc = c.ciudad && !c.ciudad.includes(':') ? encrypt(c.ciudad) : c.ciudad;
    const cpEnc = c.codigo_postal && !c.codigo_postal.includes(':') ? encrypt(c.codigo_postal) : c.codigo_postal;
    await pool.query(
      'UPDATE clientes SET email = $1, telefono = $2, direccion = $3, ciudad = $4, codigo_postal = $5 WHERE id = $6',
      [emailEnc, telEnc, dirEnc, cityEnc, cpEnc, c.id]
    );
    console.log(`  ✓ Cliente ${c.id.substring(0,8)}… cifrado`);
  }
  console.log(`  ${clients.rows.length} clientes procesados`);

  console.log('\n✅ CIFRADO COMPLETADO');
  await pool.end();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });

// src/services/cryptoService.js — Cifrado AES-256-GCM de datos sensibles
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.scryptSync(
  process.env.ENCRYPTION_KEY || 'default-key-change-me-in-production',
  'seispimientas-salt',
  32
);

// Separador para campos múltiples
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Cifra un string con AES-256-GCM
 * Formato output: base64(iv):base64(tag):base64(ciphertext)
 */
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Descifra un string cifrado con AES-256-GCM
 */
function decrypt(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;

    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    // Si falla, devolver el texto original (útil para migración de datos no cifrados)
    return encryptedText;
  }
}

/**
 * Campos sensibles por tabla que deben cifrarse
 */
const SENSITIVE_FIELDS = {
  usuarios: ['telefono'],
  clientes: ['telefono', 'direccion', 'ciudad', 'codigo_postal'],
};

/**
 * Helper: cifra campos sensibles de un objeto antes de guardar
 */
function encryptRecord(table, record) {
  const fields = SENSITIVE_FIELDS[table] || [];
  const encrypted = { ...record };
  for (const field of fields) {
    if (encrypted[field] && typeof encrypted[field] === 'string' && !encrypted[field].includes(':')) {
      encrypted[field] = encrypt(encrypted[field]);
    }
  }
  return encrypted;
}

/**
 * Helper: descifra campos sensibles de un objeto después de leer
 */
function decryptRecord(table, record) {
  if (!record) return record;
  // Si es array, procesar cada elemento
  if (Array.isArray(record)) return record.map(r => decryptRecord(table, r));

  const fields = SENSITIVE_FIELDS[table] || [];
  const decrypted = { ...record };
  for (const field of fields) {
    if (decrypted[field] && decrypted[field].includes(':')) {
      decrypted[field] = decrypt(decrypted[field]);
    }
  }
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
  encryptRecord,
  decryptRecord,
  SENSITIVE_FIELDS,
};

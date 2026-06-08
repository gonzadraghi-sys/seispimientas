// src/services/imagenes.js — Generación de imágenes multi-API
// Sin dependencias externas — usa https nativo de Node
// Cada proveedor se usa según su especialidad

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/productos_generadas');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const uso = { stability: 0, clipdrop: 0, openai: 0 };
const LIMITES = {
  stability: { max: 25, mes: 'primeros 25' },
  clipdrop:  { max: 100, mes: 'primeras 100/mes' },
  openai:    { max: 15,  mes: '$5 de crédito inicial' },
};

function nombreArchivo(productoId, nombre) {
  const base = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `${productoId.slice(0, 8)}-${base}.jpg`;
}

// ── Helper: request HTTP genérico ──
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const opt = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000,
    };

    const req = mod.request(opt, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        if (ct.includes('json') || ct.includes('text')) {
          try { resolve(JSON.parse(buf.toString())); }
          catch { resolve(buf); }
        } else {
          resolve(buf);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function generarPrompt(producto, estilo) {
  const nombre = producto.nombre || 'pasta artesanal';
  const categoria = producto.categoria || 'italian pasta';
  if (estilo === 'fotorealista') {
    return `Professional food photography of ${nombre}, ${categoria}, beautifully plated on rustic wooden table, natural window lighting, shallow depth of field, 85mm lens, highly detailed texture, appetizing, magazine quality, 8K`;
  }
  return `${nombre}, ${categoria}, artisanal Italian cuisine, editorial food styling, warm tones, soft natural light, high end restaurant presentation`;
}

// ═══ STABILITY AI — Fotorrealismo de alimentos ═══
async function conStability(producto, key) {
  const prompt = generarPrompt(producto, 'fotorealista');
  const body = JSON.stringify({
    text_prompts: [{ text: prompt, weight: 1 }],
    cfg_scale: 7, height: 1024, width: 1024, samples: 1, steps: 30,
  });

  const r = await request(
    'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    },
    body
  );

  uso.stability++;
  const b64 = r?.artifacts?.[0]?.base64;
  if (b64) return Buffer.from(b64, 'base64');
  throw new Error('Stability: sin imagen');
}

// ═══ OPENAI DALL-E 3 — Creatividad y composición ═══
async function conOpenAI(producto, key, tipo = 'producto') {
  const prompt = tipo === 'hero'
    ? 'Professional restaurant kitchen scene, Italian pasta making, warm lighting, artisanal, high end food photography, cinematic'
    : generarPrompt(producto, 'editorial');

  const r = await request(
    'https://api.openai.com/v1/images/generations',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    },
    JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'hd' })
  );

  uso.openai++;
  const url = r?.data?.[0]?.url;
  if (url) {
    const img = await request(url, {}, null);
    return Buffer.from(img);
  }
  throw new Error('DALL-E: sin imagen');
}

// ═══ CLIPDROP — Edición y mejora ═══
async function conClipdrop(producto, key) {
  const boundary = '----FormBoundary' + Date.now();
  const nombre = producto.nombre || 'pasta';
  let body = `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\ndelicious ${nombre}, Italian food, high resolution\r\n--${boundary}--\r\n`;

  const r = await request(
    'https://clipdrop-api.co/text-to-image/v1',
    {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      timeout: 30000,
    },
    body
  );

  uso.clipdrop++;
  if (Buffer.isBuffer(r)) return r;
  throw new Error('Clipdrop: sin imagen');
}

// ═══ PLACEHOLDER SVG — Siempre funciona ═══
async function placeholder(producto) {
  const color1 = '#F2EBE0', color2 = '#E8DDD0';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${color1}"/><stop offset="100%" style="stop-color:${color2}"/>
    </linearGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <circle cx="300" cy="260" r="100" fill="rgba(160,30,20,0.04)"/>
    <text x="300" y="270" font-family="Georgia,serif" font-size="160" fill="rgba(44,24,16,0.07)" text-anchor="middle" dominant-baseline="middle">SP</text>
    <text x="300" y="440" font-family="Georgia,serif" font-size="18" fill="rgba(44,24,16,0.4)" text-anchor="middle">${producto.nombre || ''}</text>
    <text x="300" y="465" font-family="sans-serif" font-size="11" fill="rgba(44,24,16,0.2)" text-anchor="middle">${producto.categoria || ''}</text>
  </svg>`;
  return Buffer.from(svg);
}

// ═══ Generar imagen para un producto ═══
async function generarImagenProducto(producto, claves = {}) {
  const filename = nombreArchivo(producto.id, producto.nombre);
  const filepath = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(filepath)) return { ok: true, filename, cache: true };

  let buffer = null, usada = null;

  // 1. Stability → fotorrealismo de alimentos
  if (!buffer && claves.stability && uso.stability < LIMITES.stability.max) {
    try { buffer = await conStability(producto, claves.stability); usada = 'stability'; }
    catch (e) { console.warn(`  Stability: ${e.message}`); }
  }

  // 2. DALL-E → composición
  if (!buffer && claves.openai && uso.openai < LIMITES.openai.max) {
    try { buffer = await conOpenAI(producto, claves.openai); usada = 'openai'; }
    catch (e) { console.warn(`  DALL-E: ${e.message}`); }
  }

  // 3. Clipdrop → respaldo
  if (!buffer && claves.clipdrop && uso.clipdrop < LIMITES.clipdrop.max) {
    try { buffer = await conClipdrop(producto, claves.clipdrop); usada = 'clipdrop'; }
    catch (e) { console.warn(`  Clipdrop: ${e.message}`); }
  }

  // 4. Placeholder SVG
  if (!buffer) { buffer = await placeholder(producto); usada = 'placeholder'; }

  fs.writeFileSync(filepath, buffer);
  console.log(`  → ${usada}: ${filename}`);
  return { ok: true, filename, usada, cache: false };
}

async function generarHero(tipo = 'hero', claves = {}) {
  const filename = `hero-${tipo}-${Date.now()}.jpg`;
  const filepath = path.join(UPLOADS_DIR, filename);
  let buffer = null;

  if (claves.openai && uso.openai < LIMITES.openai.max) {
    try { buffer = await conOpenAI({ nombre: 'hero', categoria: '' }, claves.openai, 'hero'); }
    catch (e) { console.warn(`DALL-E hero: ${e.message}`); }
  }
  if (!buffer) return { ok: false, error: 'No hay API para generar hero' };

  fs.writeFileSync(filepath, buffer);
  return { ok: true, filename };
}

function estadoAPIs(claves = {}) {
  return [
    { nombre: 'Stability AI', key: !!claves.stability, usado: uso.stability, limite: LIMITES.stability.max, especialidad: 'Fotorrealismo de alimentos' },
    { nombre: 'DALL-E 3',     key: !!claves.openai,    usado: uso.openai,    limite: LIMITES.openai.max,    especialidad: 'Composición y banners' },
    { nombre: 'Clipdrop',     key: !!claves.clipdrop,  usado: uso.clipdrop,  limite: LIMITES.clipdrop.max,  especialidad: 'Edición y mejora' },
    { nombre: 'Placeholder',  key: true,                usado: 0,             limite: Infinity,              especialidad: 'Respaldo SVG' },
  ];
}

module.exports = { generarImagenProducto, generarHero, estadoAPIs, nombreArchivo, UPLOADS_DIR };

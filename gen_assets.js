// gen_assets.js — Genera assets mínimos para la app Expo
// node gen_assets.js
const fs = require('fs');
const path = require('path');

// Crear PNG de 1px rojo (placeholder para icon/splash)
// En producción reemplazar con diseño real
function createMinimalPNG(width, height, r, g, b) {
  // Minimal valid PNG: IHDR + IDAT (raw filter 0) + IEND
  const buf = Buffer.alloc(width * height * 4 + 100);
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR chunk
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // color type: RGB
  ihdr[18] = 0; // compression
  ihdr[19] = 0; // filter
  ihdr[20] = 0; // interlace
  // CRC
  const crc = crc32(ihdr.slice(4, 21));
  ihdr.writeUInt32BE(crc, 21);

  // IDAT - raw pixel data with filter byte 0 per row
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const off = y * (1 + width * 3) + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }
  const deflated = zlib(raw);
  const idat = Buffer.alloc(12 + deflated.length + 4);
  idat.writeUInt32BE(deflated.length, 0);
  idat.write('IDAT', 4);
  deflated.copy(idat, 8);
  const idatCRC = crc32(idat.slice(4, 8 + deflated.length));
  idat.writeUInt32BE(idatCRC, 8 + deflated.length);

  // IEND
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4);
  const iendCRC = crc32(iend.slice(4, 8));
  iend.writeUInt32BE(iendCRC, 8);

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// CRC32 lookup table
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  table[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Simple zlib compress (deflate) for PNG
function zlib(data) {
  // Minimal: store-only deflate block
  const blockType = 0; // stored
  const len = data.length;
  const out = Buffer.alloc(len + 8);
  // Zlib header
  out[0] = 0x78; // CMF: deflate, window=32K
  out[1] = 0x01; // FLG: check bits
  // Deflate: final block, stored
  out[2] = 0x01; // BFINAL=1, BTYPE=00
  out[3] = len & 0xFF;
  out[4] = (len >> 8) & 0xFF;
  out[5] = (~len) & 0xFF;
  out[6] = ((~len) >> 8) & 0xFF;
  data.copy(out, 7);
  // Adler32
  let a1 = 1, a2 = 0;
  for (let i = 0; i < data.length; i++) { a1 = (a1 + data[i]) % 65521; a2 = (a2 + a1) % 65521; }
  const adler = (a2 << 16) | a1;
  out[out.length - 4] = (adler >> 24) & 0xFF;
  out[out.length - 3] = (adler >> 16) & 0xFF;
  out[out.length - 2] = (adler >> 8) & 0xFF;
  out[out.length - 1] = adler & 0xFF;
  return out.slice(3, out.length - 4); // skip zlib header & adler
}

const assetsDir = path.join(__dirname, 'assets');
const COLORS = {
  icon:        [192, 57, 43],   // #C0392B rojo
  splash:      [192, 57, 43],
  adaptive:    [192, 57, 43],
  favicon:     [192, 57, 43],
};

// Generate files
const files = [
  { name: 'icon.png',         w: 1024, h: 1024, c: COLORS.icon },
  { name: 'splash-icon.png',  w: 512,  h: 512,  c: COLORS.splash },
  { name: 'adaptive-icon.png',w: 512,  h: 512,  c: COLORS.adaptive },
];

for (const f of files) {
  const png = createMinimalPNG(f.w, f.h, f.c[0], f.c[1], f.c[2]);
  fs.writeFileSync(path.join(assetsDir, f.name), png);
  console.log(`✓ ${f.name} (${f.w}x${f.h})`);
}

console.log('✅ Assets generados — reemplazar con diseños reales antes de producción');

// db/seed.js — Datos iniciales del sistema
require('dotenv').config();
const { query, transaction } = require('../src/config/database');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

async function seed() {
  console.log('🌱 Iniciando seed...\n');

  await transaction(async (client) => {

    // ── 1. ROLES DEL SISTEMA ──────────────────────────────
    console.log('→ Creando roles...');
    const rolesData = [
      {
        nombre: 'Administrador',
        descripcion: 'Control total del sistema incluyendo configuración técnica, usuarios y backups.',
        permisos: {
          dashboard:true, stock:true, produccion:true, logistica:true,
          precios:true, mercaderia:true, locales:true, usuarios:true,
          reportes:true, backups:true, config:true, sistema:true,
          ventas_ver:true, ventas_crear:true
        },
        es_sistema: true
      },
      {
        nombre: 'Gerente General',
        descripcion: 'Acceso completo a todos los módulos de negocio. Sin acceso técnico.',
        permisos: {
          dashboard:true, stock:true, produccion:true, logistica:true,
          precios:true, mercaderia:true, locales:true, usuarios:true,
          reportes:true, backups:false, config:false, sistema:false,
          ventas_ver:true, ventas_crear:true
        },
        es_sistema: true
      },
      {
        nombre: 'Gerente de Local',
        descripcion: 'Acceso completo pero solo a su local asignado.',
        permisos: {
          dashboard:true, stock:true, produccion:true, logistica:true,
          precios:true, mercaderia:true, locales:true, usuarios:true,
          reportes:true, backups:false, config:false, sistema:false
        },
        es_sistema: true
      },
      {
        nombre: 'Vendedor',
        descripcion: 'Pedidos, clientes y precios del local asignado.',
        permisos: {
          dashboard:true, stock:true, produccion:false, logistica:false,
          precios:true, mercaderia:false, locales:false, usuarios:false,
          reportes:false, backups:false, config:false, sistema:false
        },
        es_sistema: true
      },
      {
        nombre: 'Deposito',
        descripcion: 'Stock, movimientos y despacho del local asignado.',
        permisos: {
          dashboard:true, stock:true, produccion:true, logistica:true,
          precios:false, mercaderia:true, locales:false, usuarios:false,
          reportes:false, backups:false, config:false, sistema:false
        },
        es_sistema: true
      },
      {
        nombre: 'Reportes',
        descripcion: 'Solo lectura: dashboards, reportes y exportación.',
        permisos: {
          dashboard:true, stock:false, produccion:false, logistica:false,
          precios:false, mercaderia:false, locales:false, usuarios:false,
          reportes:true, backups:false, config:false, sistema:false
        },
        es_sistema: true
      },
    ];

    const roleIds = {};
    for (const rol of rolesData) {
      const res = await client.query(
        `INSERT INTO roles (nombre, descripcion, permisos, es_sistema)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (nombre) DO UPDATE SET descripcion=$2, permisos=$3
         RETURNING id`,
        [rol.nombre, rol.descripcion, JSON.stringify(rol.permisos), rol.es_sistema]
      );
      roleIds[rol.nombre] = res.rows[0].id;
      console.log(`   ✓ Rol: ${rol.nombre}`);
    }

    // ── 2. PROVINCIA ──────────────────────────────────────
    console.log('\n→ Creando provincia de Mendoza...');
    const provRes = await client.query(
      `INSERT INTO provincias (nombre, responsable)
       VALUES ('Mendoza', 'GDRAGHI')
       ON CONFLICT DO NOTHING RETURNING id`
    );
    const provMendozaId = provRes.rows[0]?.id ||
      (await client.query(`SELECT id FROM provincias WHERE nombre='Mendoza'`)).rows[0].id;
    console.log(`   ✓ Mendoza`);

    // ── 3. LOCALES ────────────────────────────────────────
    console.log('\n→ Creando locales...');
    const localesData = [
      {
        nombre: 'Casa Central',
        tipo: 'fabrica',
        provincia_id: provMendozaId,
        direccion: 'Las Heras 890, Capital, Mendoza',
        encargado: 'GDRAGHI',
        lista_precios: 'base',
        lat: -32.8908, lng: -68.8272
      },
      {
        nombre: 'Godoy Cruz',
        tipo: 'local',
        provincia_id: provMendozaId,
        direccion: 'Av. San Martín 765, Godoy Cruz, Mendoza',
        encargado: 'M. Rodríguez',
        lista_precios: 'local',
        lat: -32.9264, lng: -68.8382
      },
      {
        nombre: 'Las Heras',
        tipo: 'local',
        provincia_id: provMendozaId,
        direccion: 'Mitre 320, Las Heras, Mendoza',
        encargado: 'C. Arce',
        lista_precios: 'local',
        lat: -32.8498, lng: -68.8228
      },
    ];

    const localIds = {};
    for (const loc of localesData) {
      const res = await client.query(
        `INSERT INTO locales
           (nombre, tipo, provincia_id, direccion, encargado, lista_precios, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING RETURNING id`,
        [loc.nombre, loc.tipo, loc.provincia_id, loc.direccion,
         loc.encargado, loc.lista_precios, loc.lat, loc.lng]
      );
      localIds[loc.nombre] = res.rows[0]?.id ||
        (await client.query(`SELECT id FROM locales WHERE nombre=$1`, [loc.nombre])).rows[0].id;
      console.log(`   ✓ ${loc.nombre}`);
    }

    // ── 4. USUARIOS ───────────────────────────────────────
    console.log('\n→ Creando usuarios...');

    // La contraseña se hashea con bcrypt — nunca en texto plano en la DB
    // IMPORTANTE: en producción las contraseñas se cambian en el primer acceso
    const PASSWORD_PLACEHOLDER = 'nobodycantouchme';
    const hash = await bcrypt.hash(PASSWORD_PLACEHOLDER, BCRYPT_ROUNDS);
    console.log('   🔒 Contraseña hasheada con bcrypt (rounds: ' + BCRYPT_ROUNDS + ')');

    const usuariosData = [
      {
        username: 'GDRAGHI',
        nombre_completo: 'G. Draghi',
        email: 'admin@seispimientas.com',
        rol: 'Administrador',
        local: null,  // acceso global
      },
      {
        username: 'DSTRAKY',
        nombre_completo: 'D. Straky',
        email: 'test@seispimientas.com',
        rol: 'Gerente de Local',
        local: 'Godoy Cruz',
      },
    ];

    for (const u of usuariosData) {
      const localId = u.local ? localIds[u.local] : null;
      await client.query(
        `INSERT INTO usuarios
           (username, password_hash, nombre_completo, email, rol_id, local_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (username) DO NOTHING`,
        [u.username, hash, u.nombre_completo, u.email, roleIds[u.rol], localId]
      );
      console.log(`   ✓ Usuario: ${u.username} (${u.rol}${u.local ? ' · ' + u.local : ' · Global'})`);
    }

    // ── 5. CATEGORÍAS DE PRODUCTOS ────────────────────────
    console.log('\n→ Creando categorías...');
    const cats = ['Rellena', 'Larga', 'Corta', 'Ñoquis'];
    const catIds = {};
    for (const cat of cats) {
      const res = await client.query(
        `INSERT INTO categorias (nombre) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING id`,
        [cat]
      );
      catIds[cat] = res.rows[0]?.id ||
        (await client.query(`SELECT id FROM categorias WHERE nombre=$1`, [cat])).rows[0].id;
      console.log(`   ✓ ${cat}`);
    }

    // ── 6. PRODUCTOS ──────────────────────────────────────
    console.log('\n→ Creando productos...');
    const productosData = [
      { nombre:'Tallarines al huevo',        cat:'Larga',   costo:850  },
      { nombre:'Ravioles ricota y espinaca',  cat:'Rellena', costo:1100 },
      { nombre:'Ñoquis de papa',              cat:'Ñoquis',  costo:700  },
      { nombre:'Sorrentinos jamón y queso',   cat:'Rellena', costo:1200 },
      { nombre:'Canelones de carne',          cat:'Rellena', costo:980  },
      { nombre:'Fideos tinta de calamar',     cat:'Larga',   costo:920  },
      { nombre:'Pappardelle',                 cat:'Larga',   costo:800  },
      { nombre:'Capeletis de ricota',         cat:'Rellena', costo:1050 },
      { nombre:'Ñoquis de espinaca',          cat:'Ñoquis',  costo:750  },
      { nombre:'Lasagna',                     cat:'Corta',   costo:1300 },
    ];

    const prodIds = {};
    for (const p of productosData) {
      const res = await client.query(
        `INSERT INTO productos (nombre, categoria_id, costo_produccion)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
        [p.nombre, catIds[p.cat], p.costo]
      );
      prodIds[p.nombre] = res.rows[0]?.id ||
        (await client.query(`SELECT id FROM productos WHERE nombre=$1`, [p.nombre])).rows[0].id;
      console.log(`   ✓ ${p.nombre}`);
    }

    // ── 7. LISTA BASE DE PRECIOS ──────────────────────────
    console.log('\n→ Creando lista de precios base...');
    const listaRes = await client.query(
      `INSERT INTO listas_precios (nombre, tipo, ajuste_pct)
       VALUES ('Lista Base','base',0)
       ON CONFLICT DO NOTHING RETURNING id`
    );
    const listaBaseId = listaRes.rows[0]?.id ||
      (await client.query(`SELECT id FROM listas_precios WHERE nombre='Lista Base'`)).rows[0].id;

    const preciosBase = {
      'Tallarines al huevo':       2500,
      'Ravioles ricota y espinaca': 3200,
      'Ñoquis de papa':            1900,
      'Sorrentinos jamón y queso': 3500,
      'Canelones de carne':        2900,
      'Fideos tinta de calamar':   2700,
      'Pappardelle':               2400,
      'Capeletis de ricota':       3100,
      'Ñoquis de espinaca':        2100,
      'Lasagna':                   3800,
    };

    for (const [nombre, precio] of Object.entries(preciosBase)) {
      await client.query(
        `INSERT INTO precios (producto_id, lista_id, precio)
         VALUES ($1,$2,$3) ON CONFLICT (producto_id, lista_id) DO UPDATE SET precio=$3`,
        [prodIds[nombre], listaBaseId, precio]
      );
    }
    console.log('   ✓ 10 precios base cargados');

  });

  console.log('\n✅ Seed completado exitosamente');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   Usuario admin:  GDRAGHI');
  console.log('   Usuario prueba: DSTRAKY');
  console.log('   ⚠️  Cambiá las contraseñas en el primer acceso');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Error en seed:', err.message);
  process.exit(1);
});

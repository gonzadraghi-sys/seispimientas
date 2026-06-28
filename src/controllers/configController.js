// src/controllers/configController.js
const { pool, query } = require('../config/database');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { ZipArchive } = require('archiver');
const { logger } = require('../services/logger');

const BACKUP_DIR = path.resolve(__dirname, '../../backups');

// Asegurar que el directorio de backups existe
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Helper: timestamp YYYYMMDD_HHmmss para nombres de archivo ─
const ts = () => {
  const d = new Date();
  return d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + '_' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
};

// ── Helper: ejecutar pg_dump ──────────────────────────────────
function ejecutarPgDump(zipFilename) {
  return new Promise((resolve, reject) => {
    const db = process.env.DB_NAME || 'seispimientas';
    const user = process.env.DB_USER || 'sp_user';
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || 5432;

    const tempName = `_temp_${Date.now()}.dump`;
    const tempPath = path.join(BACKUP_DIR, tempName);
    const zipPath = path.join(BACKUP_DIR, zipFilename);

    const env = {
      ...process.env,
      PGPASSWORD: process.env.DB_PASSWORD || '',
    };

    exec(
      `pg_dump --dbname=postgresql://${user}@${host}:${port}/${db} --format=custom --file="${tempPath}"`,
      { env, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(new Error(stderr || err.message));
          return;
        }
        // Comprimir .dump → .zip
        const output = fs.createWriteStream(zipPath);
        const archive = new ZipArchive({ zlib: { level: 9 } });

        output.on('close', () => {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          let size = 0;
          try { size = fs.statSync(zipPath).size; } catch {}
          resolve({ filepath: zipPath, size });
        });
        archive.on('error', (zipErr) => {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
          reject(zipErr);
        });

        archive.pipe(output);
        archive.file(tempPath, { name: `basededatos/${path.basename(tempPath)}` });
        archive.finalize();
      }
    );
  });
}

// ── Helper: subir a la nube (placeholder — integra con Rclone) ──
async function subirCloud(filepath, remote, ruta) {
  if (!remote) return { ok: false, error: 'Sin remote configurado' };
  try {
    const carpeta = ruta || 'seispimientas-backups';
    const destino = remote.includes(':') ? remote : `${remote}:${carpeta}/`;
    await new Promise((resolve, reject) => {
      exec(
        `rclone copy "${filepath}" "${destino}" --progress`,
        { timeout: 300000 },
        (err) => {
          if (err) reject(new Error(err.message));
          else resolve();
        }
      );
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Helper: actualizar el cron job ────────────────────────────
let cronJob = null;

function iniciarCron(cronExpr) {
  if (cronJob) { cronJob.stop(); cronJob = null; }
  if (!cronExpr) return;
  if (!cron.validate(cronExpr)) {
    console.warn(`Config: expresion cron invalida "${cronExpr}", no se programa backup automatico`);
    return;
  }
  cronJob = cron.schedule(cronExpr, async () => {
    try {
      const filename = `backup_db_${ts()}.zip`;
      await ejecutarPgDump(filename);
      await query(
        `INSERT INTO backups (filename, size_bytes, tipo, estado, ruta_local)
         VALUES ($1, $2, $3, 'completado', $4)`,
        [filename, 0, 'automatico', path.join(BACKUP_DIR, filename)]
      );
      // Actualizar tamaño
      try {
        const stat = fs.statSync(path.join(BACKUP_DIR, filename));
        await query('UPDATE backups SET size_bytes = $1 WHERE filename = $2', [stat.size, filename]);
      } catch {}
      logger.info(`Backup automatico completado: ${filename}`);
    } catch (err) {
      logger.error('Backup automatico fallo:', err.message);
    }
  });
}

// ── POST /config/backups — ejecutar backup manual ────────────
exports.crearBackup = async (req, res) => {
  try {
    const { tipo = 'manual', subir_cloud = false } = req.body;
    const filename = `backup_db_${ts()}.zip`;

    const { filepath, size } = await ejecutarPgDump(filename);

    const result = await query(
      `INSERT INTO backups (filename, size_bytes, tipo, estado, ruta_local, created_by)
       VALUES ($1, $2, $3, 'completado', $4, $5)
       RETURNING *`,
      [filename, size, tipo, filepath, req.user?.id || null]
    );

    // Subir a cloud si se solicita
    let cloudResult = null;
    if (subir_cloud) {
      const cfg = await query('SELECT cloud_proveedor, cloud_config FROM config_backup WHERE id = 1');
      const { cloud_proveedor } = cfg.rows[0];
      if (cloud_proveedor) {
        const cloud_cfg = cfg.rows[0]?.cloud_config || {};
        const remote = cloud_cfg.remote || cloud_proveedor;
        cloudResult = await subirCloud(filepath, remote, cloud_cfg.ruta);
        const cloudStatus = cloudResult.ok ? 'subido' : 'error';
        await query('UPDATE backups SET cloud_status = $1 WHERE id = $2', [cloudStatus, result.rows[0].id]);
      }
    }

    res.json({
      backup: result.rows[0],
      cloud: cloudResult,
    });
  } catch (err) {
    logger.error('Error al crear backup:', err.message);
    res.status(500).json({ error: 'Error al generar el backup: ' + err.message });
  }
};

// ── GET /config/backups — listar backups ─────────────────────
exports.listarBackups = async (req, res) => {
  try {
    const { limit = 50, offset = 0, tipo } = req.query;
    let sql = `SELECT b.*, u.username as created_by_username
               FROM backups b
               LEFT JOIN usuarios u ON u.id = b.created_by`;
    const params = [];
    if (tipo) {
      sql += ` WHERE b.tipo = $1`;
      params.push(tipo);
    }
    sql += ` ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    const count = await query('SELECT COUNT(*) FROM backups');

    res.json({
      backups: result.rows,
      total: parseInt(count.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar backups' });
  }
};

// ── GET /config/backups/:id/download — descargar backup ──────
exports.descargarBackup = async (req, res) => {
  try {
    const result = await query('SELECT * FROM backups WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Backup no encontrado' });

    const backup = result.rows[0];
    if (!fs.existsSync(backup.ruta_local))
      return res.status(404).json({ error: 'Archivo de backup no encontrado en el servidor' });

    res.download(backup.ruta_local, backup.filename);
  } catch (err) {
    res.status(500).json({ error: 'Error al descargar backup' });
  }
};

// ── DELETE /config/backups/:id — eliminar backup ─────────────
exports.eliminarBackup = async (req, res) => {
  try {
    const result = await query('SELECT * FROM backups WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Backup no encontrado' });

    const backup = result.rows[0];
    // Eliminar archivo local
    if (backup.ruta_local && fs.existsSync(backup.ruta_local)) {
      fs.unlinkSync(backup.ruta_local);
    }
    await query('DELETE FROM backups WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar backup' });
  }
};

// ── GET /config/backups/config — obtener configuracion ───────
exports.obtenerConfig = async (req, res) => {
  try {
    const result = await query('SELECT * FROM config_backup WHERE id = 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuracion' });
  }
};

// ── PUT /config/backups/config — guardar configuracion ───────
exports.guardarConfig = async (req, res) => {
  try {
    const {
      schedule_activo, schedule_cron, schedule_tipo,
      schedule_hora, retention_dias, schedule_dias,
      cloud_proveedor, cloud_config,
    } = req.body;

    // Validar y generar expresion cron si viene schedule_tipo + hora
    let cronExpr = schedule_cron || '';
    if (schedule_tipo && schedule_hora && !cronExpr) {
      const [h, m] = schedule_hora.split(':').map(Number);
      const dias = schedule_dias && schedule_dias.length > 0 ? schedule_dias : null;
      switch (schedule_tipo) {
        case 'diario':   cronExpr = `${m} ${h} * * *`; break;
        case 'semanal':
          if (dias) cronExpr = `${m} ${h} * * ${dias.join(',')}`;
          else cronExpr = `${m} ${h} * * 0`;
          break;
        case 'mensual':
          if (dias) cronExpr = `${m} ${h} ${dias.join(',')} * *`;
          else cronExpr = `${m} ${h} 1 * *`;
          break;
      }
    }

    const result = await query(
      `UPDATE config_backup SET
        schedule_activo = $1, schedule_cron = $2, schedule_tipo = $3,
        schedule_hora = $4, retention_dias = $5, schedule_dias = $6,
        cloud_proveedor = $7, cloud_config = $8,
        updated_at = NOW(), updated_by = $9
       WHERE id = 1 RETURNING *`,
      [
        schedule_activo || false, cronExpr, schedule_tipo || '',
        schedule_hora || '03:00', retention_dias || 30,
        schedule_dias || [], cloud_proveedor || '',
        JSON.stringify(cloud_config || {}),
        req.user?.id || null,
      ]
    );

    // Iniciar/detener cron segun configuracion
    if (schedule_activo && cronExpr) {
      iniciarCron(cronExpr);
    } else {
      iniciarCron(null);
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error al guardar config:', err.message);
    res.status(500).json({ error: 'Error al guardar configuracion' });
  }
};

// ── POST /config/backups/limpiar — conservar solo el ultimo de cada tipo ──
exports.limpiarBackups = async (req, res) => {
  try {
    // Agrupa por (tipo_backup, ambito) y conserva solo el mas reciente de cada grupo
    // Grupos: DB, Sistema/api, Sistema/app, Sistema/web
    const aEliminar = await query(`
      SELECT id, ruta_local, tipo_backup, ambito, created_at
      FROM backups
      WHERE id NOT IN (
        SELECT DISTINCT ON (COALESCE(tipo_backup, 'db'), COALESCE(ambito, '')) id
        FROM backups
        ORDER BY COALESCE(tipo_backup, 'db'), COALESCE(ambito, ''), created_at DESC
      )
      ORDER BY created_at DESC
    `);

    for (const b of aEliminar.rows) {
      if (b.ruta_local && fs.existsSync(b.ruta_local)) {
        fs.unlinkSync(b.ruta_local);
      }
    }

    const ids = aEliminar.rows.map(r => r.id);
    if (ids.length > 0) {
      // Borrar en lotes para no exceder parametros
      const CHUNK = 50;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const placeholders = chunk.map((_, j) => `$${j + 1}`).join(',');
        await query(`DELETE FROM backups WHERE id IN (${placeholders})`, chunk);
      }
    }

    // Armar detalle de lo que se conserva
    const conservados = await query(`
      SELECT DISTINCT ON (COALESCE(tipo_backup, 'db'), COALESCE(ambito, ''))
        tipo_backup, ambito, created_at, filename
      FROM backups
      ORDER BY COALESCE(tipo_backup, 'db'), COALESCE(ambito, ''), created_at DESC
    `);

    const detalle = conservados.rows.map(r =>
      r.tipo_backup === 'sistema' && r.ambito === 'completo'
        ? `Sistema/Completo (${r.filename})`
        : r.tipo_backup === 'sistema'
          ? `Sistema/${r.ambito} (${r.filename})`
          : `DB (${r.filename})`
    );

    res.json({
      ok: true,
      eliminados: ids.length,
      conservados: detalle,
      mensaje: ids.length > 0
        ? `Se eliminaron ${ids.length} backups. Conservados: ${detalle.join(', ')}`
        : 'Ya solo tenes el ultimo de cada tipo. No hay nada para limpiar.',
    });
  } catch (err) {
    logger.error('Error al limpiar backups:', err.message);
    res.status(500).json({ error: 'Error al limpiar backups' });
  }
};

// ── GET /config/backups/rclone-remotes — listar remotes ──────
exports.listarRemotes = async (req, res) => {
  try {
    // Ruta del archivo de config
    const configPath = await new Promise((resolve) => {
      exec('rclone config file', (err, stdout) => {
        if (err) resolve(null);
        else {
          // stdout incluye algo como "Configuration file is stored at:\nC:\Users\...\rclone.conf"
          const match = stdout.match(/(\S+rclone\.conf)/);
          resolve(match ? match[1] : stdout.trim());
        }
      });
    });

    // Listar remotes
    const remotes = await new Promise((resolve) => {
      exec('rclone listremotes', (err, stdout) => {
        if (err) resolve([]);
        else resolve(stdout.trim().split('\n').filter(Boolean));
      });
    });

    res.json({
      config_path: configPath,
      remotes,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar remotes' });
  }
};

// ── POST /config/backups/test-cloud — probar conexion cloud ──
exports.testCloud = async (req, res) => {
  try {
    const { proveedor } = req.body;
    if (!proveedor) return res.status(400).json({ error: 'Proveedor requerido' });

    // Usar remote desde la config guardada
    const cfg = await query('SELECT cloud_config FROM config_backup WHERE id = 1');
    const remote = cfg.rows[0]?.cloud_config?.remote || proveedor;
    const destino = remote.includes(':') ? remote.split(':')[0] : remote;

    const result = await new Promise((resolve) => {
      exec(`rclone lsd "${destino}:" --timeout 10s`, (err, stdout) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, output: stdout.trim() });
      });
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al probar conexion' });
  }
};

// ── Helper: crear backup del sistema (tar.gz) ──────────────────
const PROYECT_DIR = path.resolve(__dirname, '../../..');
const AMBITOS = {
  api: { nombre: 'seispimientas',     ruta: path.join(PROYECT_DIR, 'seispimientas') },
  app: { nombre: 'seispimientas-app', ruta: path.join(PROYECT_DIR, 'seispimientas-app') },
  web: { nombre: 'seispimientas-web', ruta: path.join(PROYECT_DIR, 'seispimientas-web') },
};

function crearArchivoSistema(ambito, incluirDb, incluirNodeModules, nombreArchivo = null) {
  const filename = nombreArchivo || `backup_sistema_${ambito}_${ts()}.zip`;
  const filepath = path.join(BACKUP_DIR, filename);

  // Determinar que directorios incluir
  const directorios = ambito === 'completo'
    ? Object.entries(AMBITOS)
    : (() => {
        const info = AMBITOS[ambito];
        if (!info) throw new Error('Ambito invalido: debe ser api, app, web o completo');
        if (!fs.existsSync(info.ruta)) throw new Error(`Ruta no encontrada: ${info.ruta}`);
        return [[ambito, info]];
      })();

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filepath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
      fs.stat(filepath, (err, stat) => {
        resolve({ filepath, filename, size: err ? 0 : stat.size });
      });
    });
    archive.on('error', reject);

    archive.pipe(output);

    // Agregar cada directorio
    for (const [, info] of directorios) {
      if (!fs.existsSync(info.ruta)) continue;
      archive.directory(info.ruta, info.nombre, (entry) => {
        const parts = entry.name.split('/');
        if (!incluirNodeModules && parts.includes('node_modules')) return false;
        if (parts.includes('.git')) return false;
        if (parts.includes('backups')) return false;
        return entry;
      });
    }

    // Incluir dump de DB si se solicita
    if (incluirDb) {
      const dbDump = path.join(BACKUP_DIR, `__db_dump_temp_${Date.now()}.dump`);
      try {
        const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };
        const db = process.env.DB_NAME || 'seispimientas';
        const user = process.env.DB_USER || 'sp_user';
        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || 5432;
        execSync(
          `pg_dump --dbname=postgresql://${user}@${host}:${port}/${db} --format=custom --file="${dbDump}"`,
          { env, timeout: 120000 }
        );
        if (fs.existsSync(dbDump)) {
          archive.file(dbDump, { name: `basededatos/${path.basename(dbDump)}` });
        }
      } catch (e) {
        console.warn('No se pudo incluir dump DB en backup de sistema:', e.message);
      }
    }

    archive.finalize();
  });
}

// ── POST /config/backups/sistema — backup completo del sistema (async) ─
exports.crearBackupSistema = async (req, res) => {
  try {
    const { ambito = 'api', incluir_db = true, incluir_node_modules = false, remote_id = null } = req.body;

    const filename = `backup_sistema_${ambito}_${ts()}.zip`;

    // 1. Crear registro al toque con estado 'procesando'
    const insertResult = await query(
      `INSERT INTO backups (filename, tipo, tipo_backup, ambito, estado, created_by)
       VALUES ($1, 'manual', 'sistema', $2, 'procesando', $3)
       RETURNING *`,
      [filename, ambito, req.user?.id || null]
    );

    const backupId = insertResult.rows[0].id;

    // 2. Responder ya (202 Accepted)
    res.status(202).json({
      backup: insertResult.rows[0],
      message: 'Backup iniciado. Consultá el estado con GET /config/backups/sistema/' + backupId + '/status',
    });

    // 3. Procesar en background (sin await)
    procesarBackupSistema(backupId, filename, ambito, incluir_db, incluir_node_modules, remote_id).catch(err => {
      logger.error('Error fatal en background backup:', err);
    });

  } catch (err) {
    logger.error('Error al iniciar backup de sistema:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al iniciar backup: ' + err.message });
    }
  }
};

// ── Background: procesa el backup y actualiza el registro ────────
async function procesarBackupSistema(backupId, filename, ambito, incluirDb, incluirNodeModules, remoteId) {
  try {
    logger.info('⏳ Procesando backup en background:', filename);

    const result = await crearArchivoSistema(ambito, incluirDb, incluirNodeModules, filename);
    const { filepath, size } = result;

    await query(
      `UPDATE backups SET estado = 'completado', size_bytes = $1, ruta_local = $2 WHERE id = $3`,
      [size, filepath, backupId]
    );

    // Subir a remote si se especificó
    if (remoteId) {
      const rem = await query('SELECT * FROM backup_remotes WHERE id = $1 AND activo = true', [remoteId]);
      if (rem.rows.length > 0) {
        const r = rem.rows[0];
        const cloudResult = await subirCloud(filepath, r.remote_rclone, r.ruta_destino);
        const st = cloudResult.ok ? 'subido' : 'error';
        await query('UPDATE backups SET cloud_status = $1, remote_id = $2 WHERE id = $3',
          [st, remoteId, backupId]);
      }
    }

    logger.info('✅ Backup completado:', filename, `(${size} bytes)`);
  } catch (err) {
    logger.error('❌ Error en background backup:', err.message);
    logger.error(err.stack);
    try {
      await query(
        `UPDATE backups SET estado = 'error' WHERE id = $1`,
        [backupId]
      );
    } catch (dbErr) {
      logger.error('Error al actualizar estado del backup:', dbErr.message);
    }
  }
}

// ── GET /config/backups/sistema/:id/status — estado del backup ──
exports.obtenerStatusBackupSistema = async (req, res) => {
  try {
    const result = await query('SELECT id, filename, size_bytes, tipo, tipo_backup, ambito, estado, ruta_local, cloud_status, created_at, created_by FROM backups WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Backup no encontrado' });
    }
    res.json({ backup: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estado del backup' });
  }
};

// ── CRUD REMOTES ───────────────────────────────────────────────

// GET /config/backups/remotes — listar todos
exports.listarRemotesMulti = async (req, res) => {
  try {
    const result = await query('SELECT * FROM backup_remotes ORDER BY es_default DESC, nombre ASC');
    res.json({ remotes: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar remotes' });
  }
};

// POST /config/backups/remotes — crear
exports.crearRemote = async (req, res) => {
  try {
    const { nombre, proveedor, remote_rclone, ruta_destino, es_default } = req.body;
    if (!nombre || !proveedor || !remote_rclone) {
      return res.status(400).json({ error: 'nombre, proveedor y remote_rclone son requeridos' });
    }
    // Si es default, sacar default de los demas
    if (es_default) await query('UPDATE backup_remotes SET es_default = false WHERE es_default = true');
    const result = await query(
      `INSERT INTO backup_remotes (nombre, proveedor, remote_rclone, ruta_destino, es_default)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, proveedor, remote_rclone, ruta_destino || '', es_default || false]
    );
    res.json({ remote: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear remote: ' + err.message });
  }
};

// PUT /config/backups/remotes/:id — actualizar
exports.actualizarRemote = async (req, res) => {
  try {
    const { nombre, proveedor, remote_rclone, ruta_destino, es_default } = req.body;
    if (es_default) await query('UPDATE backup_remotes SET es_default = false WHERE es_default = true');
    const result = await query(
      `UPDATE backup_remotes SET
        nombre = COALESCE($1, nombre),
        proveedor = COALESCE($2, proveedor),
        remote_rclone = COALESCE($3, remote_rclone),
        ruta_destino = COALESCE($4, ruta_destino),
        es_default = COALESCE($5, es_default),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [nombre, proveedor, remote_rclone, ruta_destino, es_default, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Remote no encontrado' });
    res.json({ remote: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar remote: ' + err.message });
  }
};

// DELETE /config/backups/remotes/:id — eliminar
exports.eliminarRemote = async (req, res) => {
  try {
    const result = await query('DELETE FROM backup_remotes WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Remote no encontrado' });
    res.json({ ok: true, remote: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar remote' });
  }
};

// PUT /config/backups/remotes/:id/default — marcar como default
exports.marcarDefaultRemote = async (req, res) => {
  try {
    await query('UPDATE backup_remotes SET es_default = false WHERE es_default = true');
    const result = await query(
      'UPDATE backup_remotes SET es_default = true, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Remote no encontrado' });
    res.json({ remote: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al marcar default' });
  }
};

// POST /config/backups/test-remote/:id — probar un remote especifico
exports.testRemote = async (req, res) => {
  try {
    const rem = await query('SELECT * FROM backup_remotes WHERE id = $1', [req.params.id]);
    if (rem.rows.length === 0) return res.status(404).json({ error: 'Remote no encontrado' });
    const r = rem.rows[0];
    const destino = r.remote_rclone.includes(':') ? r.remote_rclone.split(':')[0] : r.remote_rclone;
    const result = await new Promise((resolve) => {
      exec(`rclone lsd "${destino}:" --timeout 10s`, (err, stdout) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, output: stdout.trim() });
      });
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al probar remote' });
  }
};

// ── POST /config/backups/:id/restaurar — restaurar backup ────
exports.restaurarBackup = async (req, res) => {
  try {
    const result = await query('SELECT * FROM backups WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Backup no encontrado' });

    const backup = result.rows[0];
    if (!fs.existsSync(backup.ruta_local))
      return res.status(404).json({ error: 'Archivo de backup no encontrado en el servidor' });

    const { ambito = backup.ambito || 'db' } = req.body;
    const pasos = [];

    // ── 1. Hacer backup previo automatico antes de restaurar ──
    let preBackup = null;
    try {
      const preFilename = `pre_restore_${ts()}.zip`;
      const preDumpName = `_pre_${Date.now()}.dump`;
      const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };
      const db = process.env.DB_NAME || 'seispimientas';
      const user = process.env.DB_USER || 'sp_user';
      const host = process.env.DB_HOST || 'localhost';
      const port = process.env.DB_PORT || 5432;
      execSync(
        `pg_dump --dbname=postgresql://${user}@${host}:${port}/${db} --format=custom --file="${path.join(BACKUP_DIR, preDumpName)}"`,
        { env, timeout: 120000 }
      );
      // Comprimir en .zip
      const preZipPath = path.join(BACKUP_DIR, preFilename);
      const preOutput = fs.createWriteStream(preZipPath);
      const preArchive = new ZipArchive({ zlib: { level: 9 } });
      await new Promise((res, rej) => {
        preOutput.on('close', res);
        preArchive.on('error', rej);
        preArchive.pipe(preOutput);
        preArchive.file(path.join(BACKUP_DIR, preDumpName), { name: `basededatos/${preDumpName}` });
        preArchive.finalize();
      });
      if (fs.existsSync(path.join(BACKUP_DIR, preDumpName))) fs.unlinkSync(path.join(BACKUP_DIR, preDumpName));
      preBackup = preFilename;
      pasos.push('Backup previo de DB creado');
    } catch (e) {
      pasos.push('No se pudo crear backup previo: ' + e.message);
    }

    // ── 2. Restaurar segun tipo ──
    if (backup.tipo_backup === 'sistema') {
      // Restaurar sistema desde .zip usando PowerShell Expand-Archive
      const tempDir = path.join(BACKUP_DIR, `_extract_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      try {
        execSync(
          `powershell -Command "Expand-Archive -Path '${backup.ruta_local}' -DestinationPath '${tempDir}' -Force"`,
          { timeout: 60000 }
        );

        const destinos = {};
        if (ambito === 'completo' || ambito === 'api') {
          destinos['seispimientas'] = path.join(PROYECT_DIR, 'seispimientas');
        }
        if (ambito === 'completo' || ambito === 'app') {
          destinos['seispimientas-app'] = path.join(PROYECT_DIR, 'seispimientas-app');
        }
        if (ambito === 'completo' || ambito === 'web') {
          destinos['seispimientas-web'] = path.join(PROYECT_DIR, 'seispimientas-web');
        }

        for (const [carpeta, destino] of Object.entries(destinos)) {
          const sourceDir = path.join(tempDir, carpeta);
          if (fs.existsSync(sourceDir)) {
            if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });
            try {
              execSync(`robocopy "${sourceDir}" "${destino}" /E /IS /IT`, { timeout: 120000 });
              pasos.push(`Restaurado ${carpeta}`);
            } catch (e) {
              pasos.push(`Error restaurando ${carpeta}: ${e.message}`);
            }
          } else {
            pasos.push(`Carpeta ${carpeta} no encontrada en el backup`);
          }
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }

    // ── 3. Restaurar DB si aplica ──
    if (ambito === 'db' || ambito === 'completo' || ambito === 'db_completo') {
      const restaurarDb = ambito === 'db' || (backup.tipo_backup === 'sistema' && ambito === 'completo');
      if (restaurarDb || ambito === 'db_completo') {
        try {
          if (backup.tipo_backup === 'sistema') {
            // Buscar dump dentro del .zip y restaurarlo
            const tempDir = path.join(BACKUP_DIR, `_temp_restore_${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });
            try {
              execSync(
                `powershell -Command "Expand-Archive -Path '${backup.ruta_local}' -DestinationPath '${tempDir}' -Force"`,
                { timeout: 60000 }
              );
              const dbDir = path.join(tempDir, 'basededatos');
              const files = fs.existsSync(dbDir) ? fs.readdirSync(dbDir).filter(f => f.endsWith('.dump')) : [];
              if (files.length > 0) {
                execSync(
                  `pg_restore --dbname=postgresql://${process.env.DB_USER || 'sp_user'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'seispimientas'} --clean --if-exists "${path.join(dbDir, files[0])}"`,
                  { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' }, timeout: 300000 }
                );
                pasos.push('Base de datos restaurada desde backup de sistema');
              } else {
                pasos.push('No se encontro dump de DB dentro del backup de sistema');
              }
            } finally {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          } else {
            // Backup de DB directo (.zip)
            const tempDir = path.join(BACKUP_DIR, `_restore_db_${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });
            try {
              execSync(
                `powershell -Command "Expand-Archive -Path '${backup.ruta_local}' -DestinationPath '${tempDir}' -Force"`,
                { timeout: 60000 }
              );
              const dbDir = path.join(tempDir, 'basededatos');
              const files = fs.existsSync(dbDir) ? fs.readdirSync(dbDir).filter(f => f.endsWith('.dump')) : [];
              if (files.length > 0) {
                execSync(
                  `pg_restore --dbname=postgresql://${process.env.DB_USER || 'sp_user'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'seispimientas'} --clean --if-exists "${path.join(dbDir, files[0])}"`,
                  { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' }, timeout: 300000 }
                );
                pasos.push('Base de datos restaurada');
              } else {
                pasos.push('No se encontro dump dentro del zip');
              }
            } finally {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          }
        } catch (e) {
          pasos.push('Error restaurando DB: ' + e.message);
        }
      }
    }

    // ── 4. Registrar la restauracion ──
    await query(
      `INSERT INTO backups (filename, size_bytes, tipo, tipo_backup, estado, ruta_local, created_by)
       VALUES ($1, 0, 'restauracion', 'log', 'completado', '', $2)`,
      [`restore_${backup.filename}_${Date.now()}.log`, req.user?.id || null]
    );

    res.json({
      ok: true,
      mensaje: 'Restauracion completada',
      detalle: pasos,
      pre_backup: preBackup,
    });
  } catch (err) {
    logger.error('Error al restaurar backup:', err.message);
    res.status(500).json({ error: 'Error al restaurar backup: ' + err.message });
  }
};

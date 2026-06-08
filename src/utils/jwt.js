const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'clave_super_secreta_cambiar_en_produccion';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '_refresh';
const ACCESS_TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function generarAccessToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      username: usuario.username,
      rol_id: usuario.rol_id,
      local_id: usuario.local_id,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
}

function generarRefreshToken(usuario) {
  return jwt.sign(
    { id: usuario.id, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES }
  );
}

function verificarAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function verificarRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

module.exports = {
  generarAccessToken,
  generarRefreshToken,
  verificarAccessToken,
  verificarRefreshToken,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
};

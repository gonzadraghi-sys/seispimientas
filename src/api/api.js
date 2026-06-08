// src/api/api.js
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Cambia esta IP por la IP local de tu servidor cuando estés en la red
// o por el dominio/IP publica en produccion
const BASE_URL = 'http://192.168.1.70:3000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Adjuntar token en cada request ───────────────────────
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Renovar token expirado ────────────────────────────────
api.interceptors.response.use(
  res => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = await AsyncStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('Sin refresh token');
        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken } = res.data;
        await AsyncStorage.setItem('accessToken', accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'user']);
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login:  (data) => api.post('/auth/login', data),
  me:     ()     => api.get('/auth/me'),
  logout: ()     => api.post('/auth/logout'),
};

export const logisticaApi = {
  misPedidos:    ()           => api.get('/logistica/pedidos'),
  confirmar:     (id, codigo) => api.post('/logistica/confirmar', { pedido_id: id, codigo }),
  actualizarGPS: (data)       => api.post('/logistica/gps', data),
  problema:      (id, notas)  => api.put(`/logistica/pedidos/${id}/problema`, { notas }),
  rutaOptimizada:(data)       => api.post('/logistica/ruta-optimizada', data),
};

export default api;

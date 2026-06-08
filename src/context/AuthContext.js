// src/context/AuthContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../api/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // Restaurar sesion al abrir la app
  useEffect(() => {
    const restore = async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) setUser(JSON.parse(stored));
      } catch {}
      finally { setLoading(false); }
    };
    restore();
  }, []);

  const login = async (username, password) => {
    const res = await authApi.login({ username, password });
    const { accessToken, refreshToken, user: userData } = res.data;
    await AsyncStorage.multiSet([
      ['accessToken',  accessToken],
      ['refreshToken', refreshToken],
      ['user',         JSON.stringify(userData)],
    ]);
    setUser(userData);
    return userData;
  };

  const logout = async () => {
    try { await authApi.logout(); } catch {}
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'user']);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

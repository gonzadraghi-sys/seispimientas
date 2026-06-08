// src/screens/LoginScreen.js
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert, StatusBar,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Campos incompletos', 'Ingresa usuario y contrasena.');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim().toUpperCase(), password);
    } catch (err) {
      const msg = err.response?.data?.error || 'No se pudo conectar al servidor.';
      Alert.alert('Error de acceso', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#FDFAF5" />

      {/* Logo / Marca */}
      <View style={styles.logoArea}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoInitials}>SP</Text>
        </View>
        <Text style={styles.brand}>Seis Pimientas</Text>
        <Text style={styles.brandSub}>App de repartidores</Text>
      </View>

      {/* Formulario */}
      <View style={styles.card}>
        <Text style={styles.label}>Usuario</Text>
        <TextInput
          style={styles.input}
          placeholder="JUAN.GARCIA"
          placeholderTextColor="#BBAAA0"
          value={username}
          onChangeText={t => setUsername(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
        />

        <Text style={[styles.label, { marginTop: 16 }]}>Contrasena</Text>
        <View style={styles.passRow}>
          <TextInput
            style={styles.passInput}
            placeholder="Ingresá tu contraseña"
            placeholderTextColor="#BBAAA0"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPass}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity style={styles.passBtn} onPress={() => setShowPass(!showPass)} activeOpacity={0.7}>
            <Text style={styles.passBtnText}>{showPass ? 'Ocultar' : 'Mostrar'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Ingresar</Text>
          }
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>v1.0.0</Text>
    </KeyboardAvoidingView>
  );
}

const C = {
  red:    '#C0392B',
  cream:  '#FDFAF5',
  card:   '#FFFFFF',
  border: '#EDE8E0',
  text:   '#2C2010',
  muted:  '#8A7060',
};

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: C.cream,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  logoArea: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.red, alignItems: 'center', justifyContent: 'center',
    marginBottom: 14, elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
  },
  logoInitials: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  brand:      { fontSize: 26, fontWeight: '700', color: C.text, letterSpacing: 0.5 },
  brandSub:   { fontSize: 13, color: C.muted, marginTop: 4 },
  card: {
    width: '100%', backgroundColor: C.card,
    borderRadius: 16, padding: 24,
    elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 6,
  },
  label:      { fontSize: 12, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    padding: 14, fontSize: 15, color: C.text, backgroundColor: C.cream,
  },
  passRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    backgroundColor: C.cream,
  },
  passInput: {
    flex: 1, padding: 14, fontSize: 15, color: C.text,
  },
  passBtn: {
    paddingHorizontal: 14, paddingVertical: 14,
  },
  passBtnText: {
    fontSize: 12, fontWeight: '600', color: C.red,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  btn: {
    backgroundColor: C.red, borderRadius: 10,
    padding: 16, alignItems: 'center', marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  version:    { marginTop: 32, fontSize: 11, color: C.muted },
});

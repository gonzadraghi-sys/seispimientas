// src/screens/DevScreen.js — Pantalla de desarrollo con QR para emulador
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Linking, ScrollView,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { authApi } from '../api/api';

export default function DevScreen({ navigation }) {
  const [baseUrl, setBaseUrl] = useState('http://192.168.1.70:3000/api');
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [bioType, setBioType] = useState(null);

  useEffect(() => {
    checkBiometric();
  }, []);

  const checkBiometric = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const names = {
      1: 'Huella dactilar',
      2: 'Face ID',
      3: 'Huella + Face ID',
    };
    setBioType(types.map(t => names[t] || 'Biometría').join(', '));
  };

  const testConnection = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch(baseUrl.replace('/api', '/health'));
      const data = await res.json();
      setStatus({ ok: true, msg: `✅ Servidor OK · DB: ${data.db}` });
    } catch (e) {
      setStatus({ ok: false, msg: `❌ Error: ${e.message}` });
    } finally {
      setTesting(false);
    }
  };

  const testBiometric = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Iniciar sesión con biometría',
        fallbackLabel: 'Usar contraseña',
      });
      if (result.success) {
        Alert.alert('✅ Biometría', 'Autenticación biométrica exitosa');
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🧪 Desarrollo</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* QR Info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📱 Conexión del emulador</Text>
        <Text style={styles.cardText}>
          Para conectar desde el emulador Android al servidor local:
        </Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>10.0.2.2:{'   '}(Android emulator → localhost)</Text>
          <Text style={styles.codeText}>192.168.1.70:{' '}(tu IP local WiFi)</Text>
        </View>
        <Text style={styles.cardText}>
          Editá src/api/api.js y cambiá BASE_URL por la IP correspondiente.
        </Text>
      </View>

      {/* Test de conexión */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔌 Test de conexión</Text>
        <TextInput
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="http://IP:3000/api"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.btn, testing && styles.btnDisabled]}
          onPress={testConnection}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>Probar conexión</Text>
          )}
        </TouchableOpacity>
        {status && (
          <View style={[styles.statusBox, status.ok ? styles.statusOk : styles.statusErr]}>
            <Text style={[styles.statusText, status.ok ? { color: '#27AE60' } : { color: '#C0392B' }]}>
              {status.msg}
            </Text>
          </View>
        )}
      </View>

      {/* Biometría */}
      {bioType && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔐 Biometría</Text>
          <Text style={styles.cardText}>Disponible: {bioType}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#2C2010' }]} onPress={testBiometric}>
            <Text style={styles.btnText}>Probar biometría</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Info del dispositivo */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>ℹ️ Información</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>App</Text>
          <Text style={styles.infoVal}>Seis Pimientas v1.0.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>API</Text>
          <Text style={styles.infoVal}>{baseUrl}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Auth</Text>
          <Text style={styles.infoVal}>JWT + MFA</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#FDFAF5' },
  content:    { paddingBottom: 40 },
  header: {
    backgroundColor: '#C0392B', padding: 16, paddingTop: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn:    { paddingVertical: 4, paddingRight: 12 },
  backText:   { color: 'rgba(255,255,255,0.9)', fontSize: 15 },
  headerTitle:{ fontSize: 17, fontWeight: '700', color: '#fff' },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, margin: 16, marginBottom: 0,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3,
  },
  cardTitle:  { fontSize: 14, fontWeight: '700', color: '#2C2010', marginBottom: 10 },
  cardText:   { fontSize: 12, color: '#8A7060', lineHeight: 18, marginBottom: 10 },
  codeBox: {
    backgroundColor: '#F5F0E8', borderRadius: 8, padding: 12, marginBottom: 10,
  },
  codeText:   { fontSize: 12, color: '#2C2010', fontFamily: 'monospace', marginBottom: 4 },
  input: {
    borderWidth: 1.5, borderColor: '#EDE8E0', borderRadius: 10,
    padding: 12, fontSize: 13, color: '#2C2010', marginBottom: 10,
    backgroundColor: '#FDFAF5', fontFamily: 'monospace',
  },
  btn: {
    backgroundColor: '#C0392B', borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText:    { color: '#fff', fontWeight: '600', fontSize: 14 },
  statusBox:  { padding: 12, borderRadius: 8, marginTop: 10 },
  statusOk:   { backgroundColor: '#EAFAF1' },
  statusErr:  { backgroundColor: '#FCECEA' },
  statusText: { fontSize: 13, fontWeight: '500' },
  infoRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F5F0E8' },
  infoKey:    { fontSize: 12, color: '#8A7060' },
  infoVal:    { fontSize: 12, color: '#2C2010', fontWeight: '500' },
});

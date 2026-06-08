import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, AppState,
} from 'react-native';
import * as Location from 'expo-location';
import { logisticaApi } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { iniciarGPS, detenerGPS, gpsEstaActivo, actualizarPedidoActivo } from '../services/locationService';

const ESTADO = {
  pendiente:  { label: 'Pendiente',  color: '#8A7060', bg: '#F5F0E8' },
  en_ruta:    { label: 'En ruta',    color: '#2980B9', bg: '#EBF3FB' },
  entregado:  { label: 'Entregado',  color: '#27AE60', bg: '#EAFAF1' },
  problema:   { label: 'Problema',   color: '#C0392B', bg: '#FCECEA' },
  cancelado:  { label: 'Cancelado',  color: '#C0392B', bg: '#FCECEA' },
};

export default function HomeScreen({ navigation }) {
  const { user, logout }     = useAuth();
  const [pedidos,  setPedidos]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [refresh,  setRefresh]  = useState(false);
  const [gpsActivo,setGpsActivo]= useState(false);
  const [rutaInfo, setRutaInfo] = useState(null);

  const pedidoEnRuta = pedidos.find(p => p.estado === 'en_ruta');
  const pendientes   = pedidos.filter(p => p.estado === 'pendiente');
  const enRuta       = pedidos.filter(p => p.estado === 'en_ruta');

  const cargar = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const res = await logisticaApi.misPedidos();
      setPedidos(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error('Error cargando pedidos:', e.message);
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }, []);

  // Cargar ruta optimizada (paradas pendientes)
  const cargarRuta = useCallback(async () => {
    try {
      let lat = null, lng = null;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      } catch {}
      const res = await logisticaApi.rutaOptimizada({ lat, lng });
      setRutaInfo(res.data);
    } catch {}
  }, []);

  useEffect(() => { cargar(true); }, []);

  // Recarga cuando la app vuelve al frente
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { cargar(); verificarGPS(); }
    });
    return () => sub.remove();
  }, []);

  const verificarGPS = async () => {
    const activo = await gpsEstaActivo();
    setGpsActivo(activo);
  };

  // Iniciar/detener GPS segun estado de pedidos
  useEffect(() => {
    if (pedidoEnRuta) {
      if (!gpsActivo) {
        iniciarGPS(pedidoEnRuta.id);
        setGpsActivo(true);
      } else {
        // GPS ya activo, solo actualizar pedido de referencia
        actualizarPedidoActivo(pedidoEnRuta.id);
      }
    } else if (!pedidoEnRuta && gpsActivo) {
      detenerGPS();
      setGpsActivo(false);
    }
  }, [pedidoEnRuta]);

  useEffect(() => () => { detenerGPS(); }, []);

  const handleLogout = () => {
    Alert.alert('Cerrar sesion', '¿Seguro que queres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: logout },
    ]);
  };

  const stats = {
    pendientes:  pendientes.length,
    enRuta:      enRuta.length,
    entregados:  pedidos.filter(p => p.estado === 'entregado').length,
  };

  const tieneParadasPendientes = pendientes.length + enRuta.length > 0;

  const renderPedido = ({ item }) => {
    const st = ESTADO[item.estado] || ESTADO.pendiente;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Pedido', { pedido: item })}
        activeOpacity={0.8}
      >
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardNum}>Pedido #{item.numero}</Text>
            <Text style={styles.cardDestino}>{item.local_nombre || 'Sin destino'}</Text>
            {item.direccion_destino ? (
              <Text style={styles.cardDireccion}>📍 {item.direccion_destino}</Text>
            ) : null}
          </View>
          <View style={[styles.estadoBadge, { backgroundColor: st.bg }]}>
            <Text style={[styles.estadoText, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>

        {item.notas ? (
          <Text style={styles.cardNotas}>📋 {item.notas}</Text>
        ) : null}

        <View style={styles.cardFooter}>
          <Text style={styles.cardHora}>
            {new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.cardItems}>
            {item.cantidad_items ? `${item.cantidad_items} productos` : ''}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>Hola, {user?.nombre_completo?.split(' ')[0] || user?.username}</Text>
          <Text style={styles.headerDate}>
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* GPS indicator */}
      {gpsActivo && (
        <View style={styles.gpsBanner}>
          <View style={styles.gpsDot} />
          <Text style={styles.gpsText}>GPS activo — seguimiento en segundo plano</Text>
        </View>
      )}

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Pendientes', val: stats.pendientes, color: '#8A7060' },
          { label: 'En ruta',    val: stats.enRuta,     color: '#2980B9' },
          { label: 'Entregados', val: stats.entregados, color: '#27AE60' },
        ].map(s => (
          <View key={s.label} style={styles.statCard}>
            <Text style={[styles.statVal, { color: s.color }]}>{s.val}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Boton Ver Ruta */}
      {tieneParadasPendientes && (
        <TouchableOpacity
          style={styles.rutaBtn}
          onPress={() => navigation.navigate('Mapa', { pedidos })}
          activeOpacity={0.85}
        >
          <Text style={styles.rutaBtnText}>🗺 Ver ruta optimizada</Text>
          {rutaInfo && (
            <Text style={styles.rutaBtnSub}>
              {rutaInfo.total_paradas} paradas · {rutaInfo.total_km.toFixed(1)} km
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Lista */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#C0392B" />
          <Text style={styles.loadingText}>Cargando pedidos...</Text>
        </View>
      ) : pedidos.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📦</Text>
          <Text style={styles.emptyText}>Sin pedidos asignados hoy</Text>
          <TouchableOpacity onPress={() => cargar()} style={styles.reloadBtn}>
            <Text style={styles.reloadText}>Actualizar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={pedidos}
          keyExtractor={item => item.id}
          renderItem={renderPedido}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refresh}
              onRefresh={() => { setRefresh(true); cargar(); cargarRuta(); }}
              colors={['#C0392B']}
              tintColor="#C0392B"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const C = { red: '#C0392B', cream: '#FDFAF5', card: '#FFFFFF', border: '#EDE8E0', text: '#2C2010', muted: '#8A7060' };

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: C.cream },
  header:          { backgroundColor: C.red, padding: 20, paddingTop: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerGreeting:  { fontSize: 20, fontWeight: '700', color: '#fff' },
  headerDate:      { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2, textTransform: 'capitalize' },
  logoutBtn:       { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20 },
  logoutText:      { color: '#fff', fontSize: 13, fontWeight: '600' },
  gpsBanner:       { backgroundColor: '#EAFAF1', flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 8 },
  gpsDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: '#27AE60' },
  gpsText:         { fontSize: 12, color: '#27AE60', fontWeight: '500' },
  statsRow:        { flexDirection: 'row', margin: 16, marginBottom: 8, gap: 10 },
  statCard:        { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 14, alignItems: 'center', elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3 },
  statVal:         { fontSize: 24, fontWeight: '800' },
  statLabel:       { fontSize: 11, color: C.muted, marginTop: 2 },
  rutaBtn:         { marginHorizontal: 16, marginBottom: 8, backgroundColor: C.card, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, borderLeftWidth: 4, borderLeftColor: C.red },
  rutaBtnText:     { fontSize: 14, fontWeight: '700', color: C.text },
  rutaBtnSub:      { fontSize: 11, color: C.muted, fontWeight: '500' },
  list:            { padding: 16, paddingTop: 4, gap: 10 },
  card:            { backgroundColor: C.card, borderRadius: 14, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  cardRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardNum:         { fontSize: 11, color: C.muted, fontWeight: '500' },
  cardDestino:     { fontSize: 16, fontWeight: '700', color: C.text, marginTop: 2 },
  cardDireccion:   { fontSize: 12, color: C.muted, marginTop: 3 },
  estadoBadge:     { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  estadoText:      { fontSize: 12, fontWeight: '600' },
  cardNotas:       { fontSize: 12, color: C.muted, marginTop: 10, padding: 8, backgroundColor: '#FDFAF5', borderRadius: 8 },
  cardFooter:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cardHora:        { fontSize: 11, color: C.muted },
  cardItems:       { fontSize: 11, color: C.muted },
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:     { color: C.muted, fontSize: 13 },
  emptyEmoji:      { fontSize: 48 },
  emptyText:       { fontSize: 15, color: C.muted, fontWeight: '500' },
  reloadBtn:       { marginTop: 8, paddingVertical: 10, paddingHorizontal: 24, backgroundColor: C.red, borderRadius: 20 },
  reloadText:      { color: '#fff', fontWeight: '600' },
});

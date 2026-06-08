import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity,
  Dimensions, Alert,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { logisticaApi } from '../api/api';

const { width } = Dimensions.get('window');
const FABRICA_COLOR = '#8B0000';
const REPARTIDOR_COLOR = '#2980B9';
const DESTINO_COLOR = '#27AE60';

export default function MapaScreen({ route, navigation }) {
  const { pedidos: pedidosLista } = route.params;
  const mapRef = useRef(null);
  const [ruta, setRuta] = useState(null);
  const [ubicacionActual, setUbicacionActual] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([obtenerUbicacion(), cargarRuta()]).finally(() => setLoading(false));
  }, []);

  const obtenerUbicacion = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setUbicacionActual({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    } catch {}
  };

  const cargarRuta = async () => {
    try {
      // Intentar obtener ubicacion para el request
      let lat = null, lng = null;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      } catch {}
      const res = await logisticaApi.rutaOptimizada({ lat, lng });
      setRuta(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'No se pudo calcular la ruta');
    }
  };

  // Coordenadas del origen (fabrica o ubicacion actual)
  const origen = ruta?.origen;
  // Coordenadas de fabrica (si existe)
  const fabrica = ruta?.fabrica;

  // Armar array de coordenadas para polyline
  const coordenadasRuta = [];
  if (origen && ruta?.paradas?.length > 0) {
    coordenadasRuta.push({ latitude: origen.lat, longitude: origen.lng });
    ruta.paradas.forEach(p => {
      coordenadasRuta.push({ latitude: p.lat, longitude: p.lng });
    });
  }

  // Ajustar region del mapa para mostrar todos los puntos
  const getRegion = () => {
    const puntos = [];
    if (fabrica) puntos.push({ lat: fabrica.lat, lng: fabrica.lng });
    if (origen) puntos.push({ lat: origen.lat, lng: origen.lng });
    if (ruta?.paradas) ruta.paradas.forEach(p => puntos.push({ lat: p.lat, lng: p.lng }));

    if (puntos.length === 0) return { latitude: -34.60, longitude: -58.38, latitudeDelta: 0.1, longitudeDelta: 0.1 };

    const lats = puntos.map(p => p.lat);
    const lngs = puntos.map(p => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latDelta = (maxLat - minLat) * 1.5 || 0.05;
    const lngDelta = (maxLng - minLng) * 1.5 || 0.05;

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(latDelta, 0.02),
      longitudeDelta: Math.max(lngDelta, 0.02),
    };
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Volver</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ruta optimizada</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#C0392B" />
          <Text style={styles.loadingText}>Calculando ruta...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Volver</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ruta</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.center}>
          <Text style={{ color: '#C0392B', fontSize: 15, marginBottom: 12 }}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); setError(null); cargarRuta().finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const paradas = ruta?.paradas || [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ruta optimizada</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Mapa */}
      <MapView ref={mapRef} style={styles.map} initialRegion={getRegion()} showsUserLocation={false}>
        {/* Marcador fábrica */}
        {fabrica && (
          <Marker
            coordinate={{ latitude: fabrica.lat, longitude: fabrica.lng }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={[styles.marker, { backgroundColor: FABRICA_COLOR, width: 36, height: 36, borderRadius: 18 }]}>
              <Text style={styles.markerIcon}>🏭</Text>
            </View>
          </Marker>
        )}

        {/* Marcador origen (repartidor) */}
        {origen && (
          <Marker
            coordinate={{ latitude: origen.lat, longitude: origen.lng }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={[styles.marker, { backgroundColor: REPARTIDOR_COLOR }]}>
              <Text style={styles.markerText}>R</Text>
            </View>
          </Marker>
        )}

        {/* Marcadores de destino (paradas) */}
        {paradas.map((p, i) => (
          <Marker
            key={p.pedido_id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title={`${p.local} #${p.numero}`}
            description={`${p.items} productos — ${p.distancia} km`}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={[styles.marker, { backgroundColor: DESTINO_COLOR }]}>
              <Text style={styles.markerText}>{i + 1}</Text>
            </View>
          </Marker>
        ))}

        {/* Línea de ruta */}
        {coordenadasRuta.length > 1 && (
          <Polyline coordinates={coordenadasRuta} strokeColor="#C0392B" strokeWidth={3} lineDashPattern={[8, 4]} />
        )}
      </MapView>

      {/* Panel inferior con lista de paradas */}
      {paradas.length > 0 && (
        <View style={styles.bottomSheet}>
          <Text style={styles.bottomTitle}>
            {paradas.length} {paradas.length === 1 ? 'parada' : 'paradas'} · Total {ruta?.total_km?.toFixed(1)} km
          </Text>
          {paradas.map((p, i) => (
            <View key={p.pedido_id} style={styles.paradaRow}>
              <View style={[styles.paradaNum, { backgroundColor: DESTINO_COLOR }]}>
                <Text style={styles.paradaNumText}>{i + 1}</Text>
              </View>
              <View style={styles.paradaInfo}>
                <Text style={styles.paradaLocal}>{p.local}</Text>
                <Text style={styles.paradaDireccion}>{p.direccion}</Text>
              </View>
              <Text style={styles.paradaDist}>{p.distancia.toFixed(1)} km</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDFAF5' },
  header: {
    backgroundColor: '#C0392B', padding: 16, paddingTop: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { paddingVertical: 4, paddingRight: 12 },
  backText: { color: 'rgba(255,255,255,0.9)', fontSize: 15 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#8A7060', fontSize: 13 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 24, backgroundColor: '#C0392B', borderRadius: 20 },
  retryText: { color: '#fff', fontWeight: '600' },
  map: { flex: 1 },
  marker: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3,
  },
  markerText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  markerIcon: { fontSize: 16 },
  bottomSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 32, maxHeight: 260,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 6,
  },
  bottomTitle: { fontSize: 13, fontWeight: '600', color: '#8A7060', marginBottom: 12 },
  paradaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  paradaNum: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  paradaNumText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  paradaInfo: { flex: 1 },
  paradaLocal: { fontSize: 13, fontWeight: '600', color: '#2C2010' },
  paradaDireccion: { fontSize: 11, color: '#8A7060', marginTop: 1 },
  paradaDist: { fontSize: 11, color: '#8A7060', fontWeight: '500' },
});

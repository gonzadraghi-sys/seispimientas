// src/screens/PedidoScreen.js
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { logisticaApi } from '../api/api';

export default function PedidoScreen({ route, navigation }) {
  const { pedido: pedidoInicial } = route.params;
  const [pedido,    setPedido]    = useState(pedidoInicial);
  const [loading,   setLoading]   = useState(false);
  const [modalConf, setModalConf] = useState(false);
  const [modalProb, setModalProb] = useState(false);
  const [codigo,    setCodigo]    = useState('');
  const [codigoErr, setCodigoErr] = useState('');
  const [notasProb, setNotasProb] = useState('');
  const [ubicacion, setUbicacion] = useState(null);
  const [fabrica,   setFabrica]   = useState(null);

  const puedeIniciar  = pedido.estado === 'pendiente';
  const puedeConfirmar= pedido.estado === 'en_ruta';
  const puedeProblema = ['pendiente', 'en_ruta'].includes(pedido.estado);

  // Obtener ubicacion actual y datos de fabrica para el mapa
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setUbicacion({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch {}
    })();
    // Obtener datos de la ruta para conseguir la fabrica
    (async () => {
      try {
        const res = await logisticaApi.rutaOptimizada({});
        if (res.data?.fabrica) {
          setFabrica({
            latitude: parseFloat(res.data.fabrica.lat),
            longitude: parseFloat(res.data.fabrica.lng),
            nombre: res.data.fabrica.nombre,
          });
        }
      } catch {}
    })();
  }, []);

  // ── Iniciar ruta ────────────────────────────────────────
  const iniciarRuta = async () => {
    Alert.alert('Iniciar entrega', `Vas a marcar el pedido #${pedido.numero} como en ruta.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Iniciar', onPress: async () => {
          setLoading(true);
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            let lat = null, lng = null;
            if (status === 'granted') {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
              lat = loc.coords.latitude;
              lng = loc.coords.longitude;
            }
            await logisticaApi.actualizarGPS({ pedido_id: pedido.id, lat, lng, estado: 'en_ruta' });
            setPedido(p => ({ ...p, estado: 'en_ruta' }));
            Alert.alert('En ruta', 'El GPS se activo automaticamente. Se actualiza cada 30 segundos.');
          } catch (e) {
            Alert.alert('Error', e.response?.data?.error || 'No se pudo iniciar la ruta.');
          } finally { setLoading(false); }
        },
      },
    ]);
  };

  // ── Confirmar con codigo ────────────────────────────────
  const confirmar = async () => {
    if (codigo.length !== 4) { setCodigoErr('El codigo debe tener 4 digitos'); return; }
    setCodigoErr('');
    setLoading(true);
    try {
      await logisticaApi.confirmar(pedido.id, codigo);
      setPedido(p => ({ ...p, estado: 'entregado' }));
      setModalConf(false);
      setCodigo('');
      Alert.alert('Entrega confirmada', 'El stock fue actualizado correctamente.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      setCodigoErr(e.response?.data?.error || 'Codigo incorrecto. Reintenta.');
    } finally { setLoading(false); }
  };

  // ── Reportar problema ───────────────────────────────────
  const reportarProblema = async () => {
    if (!notasProb.trim()) { Alert.alert('Descripcion requerida', 'Explicá brevemente el problema.'); return; }
    setLoading(true);
    try {
      await logisticaApi.problema(pedido.id, notasProb);
      setPedido(p => ({ ...p, estado: 'problema' }));
      setModalProb(false);
      setNotasProb('');
      Alert.alert('Problema reportado', 'Se notifico al administrador.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.error || 'No se pudo reportar el problema.');
    } finally { setLoading(false); }
  };

  const st = {
    pendiente: { label: 'Pendiente', color: '#8A7060', bg: '#F5F0E8' },
    en_ruta:   { label: 'En ruta',   color: '#2980B9', bg: '#EBF3FB' },
    entregado: { label: 'Entregado', color: '#27AE60', bg: '#EAFAF1' },
    problema:  { label: 'Problema',  color: '#C0392B', bg: '#FCECEA' },
  }[pedido.estado] || { label: pedido.estado, color: '#888', bg: '#eee' };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pedido #{pedido.numero}</Text>
        <View style={[styles.estadoBadge, { backgroundColor: st.bg }]}>
          <Text style={[styles.estadoText, { color: st.color }]}>{st.label}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Destino */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Destino</Text>
          <Text style={styles.destino}>{pedido.local_nombre || 'Sin nombre'}</Text>
          {pedido.direccion_destino ? (
            <Text style={styles.direccion}>📍 {pedido.direccion_destino}</Text>
          ) : null}
          {pedido.telefono_destino ? (
            <Text style={styles.telefono}>📞 {pedido.telefono_destino}</Text>
          ) : null}
        </View>

        {/* Mini-mapa con 3 puntos: fabrica, repartidor, destino */}
        {(pedido.lat && pedido.lng) || ubicacion ? (
          <View style={styles.card}>

            <MapView
              style={{ height: 200, borderRadius: 10 }}
              initialRegion={{
                latitude: parseFloat(pedido.lat || ubicacion?.latitude || -34.6),
                longitude: parseFloat(pedido.lng || ubicacion?.longitude || -58.38),
                latitudeDelta: 0.08,
                longitudeDelta: 0.08,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
            >
              {/* Marcador fabrica */}
              {fabrica && (
                <Marker coordinate={{ latitude: fabrica.latitude, longitude: fabrica.longitude }} anchor={{ x: 0.5, y: 1 }}>
                  <View style={styles.markerFabrica}>
                    <Text style={styles.markerIcon}>🏭</Text>
                  </View>
                </Marker>
              )}

              {/* Marcador repartidor */}
              {ubicacion && (
                <Marker coordinate={ubicacion} anchor={{ x: 0.5, y: 1 }}>
                  <View style={styles.markerRepartidor}>
                    <Text style={styles.markerLetra}>R</Text>
                  </View>
                </Marker>
              )}

              {/* Marcador destino */}
              {pedido.lat && pedido.lng && (
                <Marker
                  coordinate={{ latitude: parseFloat(pedido.lat), longitude: parseFloat(pedido.lng) }}
                  title={pedido.local_nombre || 'Destino'}
                  description={pedido.direccion_destino}
                  anchor={{ x: 0.5, y: 1 }}
                >
                  <View style={styles.markerDestino}>
                    <Text style={styles.markerLetra}>D</Text>
                  </View>
                </Marker>
              )}

              {/* Linea de ruta */}
              {ubicacion && pedido.lat && pedido.lng && (
                <Polyline
                  coordinates={[
                    ubicacion,
                    { latitude: parseFloat(pedido.lat), longitude: parseFloat(pedido.lng) },
                  ]}
                  strokeColor="#C0392B"
                  strokeWidth={2}
                  lineDashPattern={[6, 4]}
                />
              )}
            </MapView>
          </View>
        ) : null}

        {/* Items */}
        {pedido.items?.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Productos a entregar</Text>
            {pedido.items.map((item, i) => (
              <View key={i} style={styles.itemRow}>
                <Text style={styles.itemNombre}>{item.producto || item.producto_nombre}</Text>
                <Text style={styles.itemCant}>{item.cantidad} {item.unidad_medida || 'u'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Notas */}
        {pedido.notas ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Text style={styles.notas}>{pedido.notas}</Text>
          </View>
        ) : null}

        {/* Info adicional */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informacion</Text>
          {[
            ['Creado',    new Date(pedido.created_at).toLocaleString('es-AR')],
            ['Numero',    `#${pedido.numero}`],
          ].map(([k, v]) => (
            <View key={k} style={styles.infoRow}>
              <Text style={styles.infoKey}>{k}</Text>
              <Text style={styles.infoVal}>{v}</Text>
            </View>
          ))}
        </View>

        {/* Acciones */}
        <View style={styles.acciones}>
          {puedeIniciar && (
            <TouchableOpacity style={[styles.btn, styles.btnBlue]} onPress={iniciarRuta} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>🚚 Iniciar entrega</Text>}
            </TouchableOpacity>
          )}

          {puedeConfirmar && (
            <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={() => { setModalConf(true); setCodigo(''); setCodigoErr(''); }} disabled={loading}>
              <Text style={styles.btnText}>✅ Confirmar entrega</Text>
            </TouchableOpacity>
          )}

          {puedeProblema && (
            <TouchableOpacity style={[styles.btn, styles.btnRed]} onPress={() => setModalProb(true)} disabled={loading}>
              <Text style={styles.btnText}>⚠ Reportar problema</Text>
            </TouchableOpacity>
          )}

          {pedido.estado === 'entregado' && (
            <View style={styles.completado}>
              <Text style={styles.completadoText}>Entrega completada</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Modal confirmar ─── */}
      <Modal visible={modalConf} transparent animationType="slide" onRequestClose={() => setModalConf(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Codigo de confirmacion</Text>
            <Text style={styles.modalSub}>Pedile al encargado del local el codigo de 4 digitos.</Text>
            <TextInput
              style={[styles.codigoInput, codigoErr ? { borderColor: '#C0392B' } : {}]}
              value={codigo}
              onChangeText={t => { setCodigo(t.replace(/\D/g, '').slice(0, 4)); setCodigoErr(''); }}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="0000"
              placeholderTextColor="#BBAAA0"
            />
            {codigoErr ? <Text style={styles.codigoErr}>{codigoErr}</Text> : null}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: '#EDE8E0' }]} onPress={() => setModalConf(false)}>
                <Text style={[styles.btnText, { color: '#2C2010' }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnGreen, { flex: 1 }]} onPress={confirmar} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Confirmar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal problema ─── */}
      <Modal visible={modalProb} transparent animationType="slide" onRequestClose={() => setModalProb(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reportar problema</Text>
            <Text style={styles.modalSub}>Describe que paso con esta entrega.</Text>
            <TextInput
              style={[styles.codigoInput, { height: 90, textAlignVertical: 'top', fontSize: 14, padding: 12 }]}
              value={notasProb}
              onChangeText={setNotasProb}
              multiline
              placeholder="Ej: No habia nadie en el local..."
              placeholderTextColor="#BBAAA0"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: '#EDE8E0' }]} onPress={() => setModalProb(false)}>
                <Text style={[styles.btnText, { color: '#2C2010' }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnRed, { flex: 1 }]} onPress={reportarProblema} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reportar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#FDFAF5' },
  header:         { backgroundColor: '#C0392B', padding: 20, paddingTop: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back:           { marginRight: 4 },
  backText:       { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  headerTitle:    { flex: 1, fontSize: 17, fontWeight: '700', color: '#fff' },
  estadoBadge:    { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  estadoText:     { fontSize: 12, fontWeight: '600' },
  content:        { padding: 16, gap: 12, paddingBottom: 40 },
  card:           { backgroundColor: '#fff', borderRadius: 14, padding: 16, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3 },
  sectionTitle:   { fontSize: 10, fontWeight: '700', color: '#8A7060', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  destino:        { fontSize: 18, fontWeight: '700', color: '#2C2010' },
  direccion:      { fontSize: 13, color: '#8A7060', marginTop: 6 },
  telefono:       { fontSize: 13, color: '#8A7060', marginTop: 4 },
  itemRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F5F0E8' },
  itemNombre:     { fontSize: 14, color: '#2C2010', flex: 1 },
  itemCant:       { fontSize: 14, fontWeight: '700', color: '#C0392B' },
  notas:          { fontSize: 14, color: '#2C2010', lineHeight: 20 },
  infoRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  infoKey:        { fontSize: 13, color: '#8A7060' },
  infoVal:        { fontSize: 13, color: '#2C2010', fontWeight: '500' },
  acciones:       { gap: 10 },
  btn:            { borderRadius: 12, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  btnBlue:        { backgroundColor: '#2980B9' },
  btnGreen:       { backgroundColor: '#27AE60' },
  btnRed:         { backgroundColor: '#C0392B' },
  btnText:        { color: '#fff', fontWeight: '700', fontSize: 15 },
  completado:     { backgroundColor: '#EAFAF1', borderRadius: 12, padding: 16, alignItems: 'center' },
  completadoText: { color: '#27AE60', fontWeight: '700', fontSize: 15 },
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard:      { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalTitle:     { fontSize: 18, fontWeight: '700', color: '#2C2010' },
  modalSub:       { fontSize: 13, color: '#8A7060', lineHeight: 18 },
  codigoInput:    { borderWidth: 2, borderColor: '#EDE8E0', borderRadius: 12, padding: 16, fontSize: 28, fontWeight: '700', letterSpacing: 12, textAlign: 'center', color: '#2C2010', backgroundColor: '#FDFAF5' },
  codigoErr:      { fontSize: 12, color: '#C0392B', textAlign: 'center' },
  modalBtns:      { flexDirection: 'row', gap: 10 },
  markerFabrica:  { width: 32, height: 32, borderRadius: 16, backgroundColor: '#8B0000', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3 },
  markerRepartidor: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2980B9', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3 },
  markerDestino:  { width: 30, height: 30, borderRadius: 15, backgroundColor: '#27AE60', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3 },
  markerIcon:     { fontSize: 14 },
  markerLetra:    { color: '#fff', fontWeight: '800', fontSize: 12 },
});

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { logisticaApi } from '../api/api';

export const LOCATION_TASK_NAME = 'seispimientas-background-gps';

let pedidoActualId = null;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  if (data?.locations?.length > 0) {
    const loc = data.locations[0];
    try {
      await logisticaApi.actualizarGPS({
        pedido_id: pedidoActualId,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
    } catch {}
  }
});

export async function solicitarPermisos() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;

  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === 'granted';
}

export async function iniciarGPS(pedidoId) {
  pedidoActualId = pedidoId;

  const ok = await solicitarPermisos();
  if (!ok) return false;

  const yaActivo = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (yaActivo) return true;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 20000,
    distanceInterval: 30,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Seis Pimientas',
      notificationBody: 'GPS activo — registrando entregas en segundo plano',
      notificationColor: '#C0392B',
    },
    pausesUpdatesAutomatically: false,
  });
  return true;
}

export async function detenerGPS() {
  pedidoActualId = null;
  const registrado = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (registrado) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

export async function gpsEstaActivo() {
  return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
}

export function actualizarPedidoActivo(pedidoId) {
  pedidoActualId = pedidoId;
}

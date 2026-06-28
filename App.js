// App.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen  from './src/screens/LoginScreen';
import HomeScreen   from './src/screens/HomeScreen';
import PedidoScreen from './src/screens/PedidoScreen';
import MapaScreen   from './src/screens/MapaScreen';
import DevScreen    from './src/screens/DevScreen';

const Stack = createNativeStackNavigator();

function Navigation() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      {user ? (
        <>
          <Stack.Screen name="Home"   component={HomeScreen} />
          <Stack.Screen name="Pedido" component={PedidoScreen} />
          <Stack.Screen name="Mapa"   component={MapaScreen} />
          <Stack.Screen name="Dev"    component={DevScreen} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Navigation />
      </NavigationContainer>
    </AuthProvider>
  );
}

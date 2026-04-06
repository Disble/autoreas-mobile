# SDD-07: Configuración Síncrona, Formularios y Deep Linking

**Estado:** Draft (Pendiente de Revisión Adversarial)
**Track:** Device (Fase 3)

## 1. Objetivo
Definir el proceso de Onboarding de la aplicación Autoreas Mobile, permitiendo emparejar el celular con el servidor PC (Bridge) y guardar esta configuración para arranques asíncronos súper rápidos y persistentes, sin flashear pantallas de Setup.

## 2. Boot Inmediato y Seguridad de Credenciales

Si guardamos la IP y Token en `SecureStore`, la lectura es asíncrona y la UI de Expo Router tendría un parpadeo visual. Sin embargo, guardar JWTs en SQLite plano es un riesgo inaceptable, incluso para una app de red local (si hay backup en la nube o root device).

- **Solución (Splash Screen + Async Híbrido):** 
  En lugar de leer síncronamente de SQLite, en `app/_layout.tsx` se utilizará `expo-splash-screen` con `SplashScreen.preventAutoHideAsync()`. 
  - Esto mantendrá la pantalla de carga del celular congelada.
  - En background, se leerá asincrónicamente el Token de `SecureStore` y la IP/Puerto de `AsyncStorage` (o SQLite).
  - Una vez leídos, el estado se inyecta en Zustand, se decide la ruta inicial (`/setup` o `/(tabs)`), y recién entonces se ejecuta `SplashScreen.hideAsync()`, logrando un boot sin flickering blanco y 100% seguro.

## 3. El Flujo de Pairing y Formularios Resilientes

1. App abre -> No hay Token en SecureStore -> Navega a `app/setup.tsx`.
2. UI: Formulario con IP, Puerto y Token.
3. Botón "Conectar":
   - Ejecuta un `POST http://IP:PUERTO/api/devices/pair`.
   - **Requisito Crítico (Red y Firewall):** El request debe tener un **Timeout Estricto de 3 a 5 segundos** (Axios timeout). 
   - **Manejo de Errores:** Si falla (Network Error o Timeout), la UI DEBE mostrar un toast explicando: "Verifica que el PC esté prendido, en la misma red WiFi, y que el firewall de Windows no esté bloqueando el puerto X".
4. Si devuelve `200 OK`, el cliente guarda el Token en `SecureStore`, la IP en SQLite/Zustand, y hace `router.replace('/(tabs)')`.

## 4. Deep Linking y Fallback Seguro

Para evitar escribir la IP y Token a mano (tedioso en celulares), la app admitirá Deep Links a través de `expo-linking`:
- Formato: `autoreas://pair?ip=192.168.0.100&port=8080&token=ABC123XYZ`
- La app interceptará esta URI en `_layout.tsx` o `setup.tsx` y auto-rellenará el formulario, disparando automáticamente el request de pairing al Bridge.
- **Fallback:** Si el request disparado por el Deep Link falla (ej. el PC cerró el puerto o la IP cambió), el usuario NO DEBE quedar atrapado. El formulario debe quedar visible, con los datos auto-rellenados y permitiendo su edición manual para reintentar.
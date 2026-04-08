import { useURL } from 'expo-linking';
import { Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { usePairDevice } from '../../features/setup/use-pair-device';

export default function SetupScreen() {
  const router = useRouter();
  const { pair, isLoading, error } = usePairDevice();
  const url = useURL();

  const [ip, setIp] = useState('');
  const [port, setPort] = useState('8080');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (url) {
      try {
        const parsedUrl = new URL(url);
        // The URL from deep link could be something like autoreas://pair?ip=192.168.1.10&...
        if (
          parsedUrl.protocol.replace(':', '') === 'autoreas' &&
          parsedUrl.hostname === 'pair'
        ) {
          const params = new URLSearchParams(parsedUrl.search);
          const ipParam = params.get('ip');
          const portParam = params.get('port');
          const tokenParam = params.get('token');

          if (ipParam) setIp(ipParam);
          if (portParam) setPort(portParam);
          if (tokenParam) setToken(tokenParam);
        }
      } catch (e) {
        console.warn('Invalid deep link URL:', url);
      }
    }
  }, [url]);

  const handlePair = async () => {
    if (!ip || !port || !token) {
      Alert.alert('Error', 'Todos los campos son obligatorios');
      return;
    }

    const portNumber = parseInt(port, 10);
    if (isNaN(portNumber)) {
      Alert.alert('Error', 'El puerto debe ser un número válido');
      return;
    }

    const { success, error: pairError } = await pair({ ip, port: portNumber, token });

    if (success) {
      router.replace('/(tabs)' as Href);
    } else {
      Alert.alert('Error de conexión', pairError || 'No se pudo conectar con el Bridge');
    }
  };

  return (
    <View className="flex-1 justify-center bg-black px-6">
      <View className="mb-8 items-center">
        <Text className="mb-2 text-3xl font-bold text-white">Autoreas</Text>
        <Text className="text-center text-gray-400">
          Ingresa los datos de tu Bridge para emparejar el dispositivo.
        </Text>
      </View>

      <View className="gap-y-4 space-y-4">
        <View>
          <Text className="mb-1 text-sm font-medium text-gray-300">Dirección IP</Text>
          <TextInput
            className="w-full rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-white"
            placeholder="Ej: 192.168.1.10"
            placeholderTextColor="#666"
            value={ip}
            onChangeText={setIp}
            keyboardType="decimal-pad"
            autoCapitalize="none"
          />
        </View>

        <View>
          <Text className="mb-1 text-sm font-medium text-gray-300">Puerto</Text>
          <TextInput
            className="w-full rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-white"
            placeholder="8080"
            placeholderTextColor="#666"
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
          />
        </View>

        <View>
          <Text className="mb-1 text-sm font-medium text-gray-300">Token de emparejamiento</Text>
          <TextInput
            className="w-full rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-white"
            placeholder="Token mostrado en el Bridge"
            placeholderTextColor="#666"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            secureTextEntry
          />
        </View>

        {error ? <Text className="mt-2 text-center text-sm text-red-500">{error}</Text> : null}

        <Pressable
          onPress={handlePair}
          disabled={isLoading}
          className={`mt-6 w-full items-center justify-center rounded-xl py-4 ${
            isLoading ? 'bg-indigo-900' : 'bg-indigo-600 active:bg-indigo-700'
          }`}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">Emparejar Bridge</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

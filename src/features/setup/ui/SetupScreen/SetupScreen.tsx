import { Ionicons } from '@expo/vector-icons';
import {
  Alert as HeroAlert,
  Button,
  Card,
  Input,
  Label,
  Separator,
  Spinner,
  Surface,
  TextField,
  cn,
} from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { SetupQrScanner } from '../SetupQrScanner';
import {
  SETUP_PAIR_BUTTON_LABEL,
  SETUP_QR_SCAN_BUTTON_LABEL,
} from './setup-screen.constants';
import type { SetupScreenProps } from './setup-screen.types';
import { useSetupScreen } from './use-setup-screen';

/** Renders the branded header with the pairing icon and intro copy. */
function SetupHeader() {
  return (
    <View className="mb-8 items-center">
      <Surface className="mb-4 rounded-full p-4" variant="secondary">
        <Ionicons color="#6366f1" name="link-outline" size={32} />
      </Surface>
      <AppText className="mb-1 text-3xl font-bold tracking-tight text-foreground">
        Autoreas
      </AppText>
      <AppText className="max-w-[260px] text-center text-sm text-muted">
        Conecta tu dispositivo con el Bridge para sincronizar tu lista de animes.
      </AppText>
    </View>
  );
}

/** Renders one labeled manual-pairing text field. */
function SetupTextField({
  autoCapitalize,
  keyboardType,
  label,
  onChangeText,
  placeholder,
  secureTextEntry,
  value,
}: {
  readonly autoCapitalize?: 'none';
  readonly keyboardType?: 'decimal-pad' | 'number-pad';
  readonly label: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder: string;
  readonly secureTextEntry?: boolean;
  readonly value: string;
}) {
  return (
    <TextField>
      <Label>
        <Label.Text>{label}</Label.Text>
      </Label>
      <Input
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        value={value}
      />
    </TextField>
  );
}

/** Renders the danger alert for a pairing error, or nothing while there is no error. */
function SetupErrorAlert({ error }: { readonly error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <HeroAlert status="danger">
      <HeroAlert.Indicator />
      <HeroAlert.Content>
        <HeroAlert.Description>{error}</HeroAlert.Description>
      </HeroAlert.Content>
    </HeroAlert>
  );
}

/** Renders the toggle button that shows or hides the QR scanner. */
function ScannerToggleButton({
  isScannerVisible,
  onPress,
}: {
  readonly isScannerVisible: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Button onPress={onPress} size="lg" variant="secondary">
      <Ionicons color="#6366f1" name="qr-code-outline" size={18} />
      <Button.Label>
        {isScannerVisible ? 'Ocultar escáner' : SETUP_QR_SCAN_BUTTON_LABEL}
      </Button.Label>
    </Button>
  );
}

/** Renders the primary pairing button with its loading spinner state. */
function PairButton({
  isLoading,
  onPress,
}: {
  readonly isLoading: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Button
      className={cn('w-full', isLoading && 'opacity-80')}
      isDisabled={isLoading}
      onPress={onPress}
      size="lg"
      variant="primary"
    >
      {isLoading ? (
        <Spinner className="text-white" />
      ) : (
        <Button.Label>{SETUP_PAIR_BUTTON_LABEL}</Button.Label>
      )}
    </Button>
  );
}

/** Renders the card that groups the manual credentials form and its actions. */
function SetupCredentialsCard({
  error,
  handleCloseScanner,
  handlePair,
  handleQrScan,
  handleToggleScanner,
  ip,
  isLoading,
  isScannerVisible,
  port,
  setIp,
  setPort,
  setToken,
  token,
}: {
  readonly error: string | null;
  readonly handleCloseScanner: () => void;
  readonly handlePair: () => void;
  readonly handleQrScan: (rawValue: string) => void;
  readonly handleToggleScanner: () => void;
  readonly ip: string;
  readonly isLoading: boolean;
  readonly isScannerVisible: boolean;
  readonly port: string;
  readonly setIp: (text: string) => void;
  readonly setPort: (text: string) => void;
  readonly setToken: (text: string) => void;
  readonly token: string;
}) {
  return (
    <Card className="p-5">
      <Card.Body className="gap-4">
        <SetupTextField
          autoCapitalize="none"
          keyboardType="decimal-pad"
          label="Dirección IP"
          onChangeText={setIp}
          placeholder="Ej: 192.168.1.10"
          value={ip}
        />

        <SetupTextField
          keyboardType="number-pad"
          label="Puerto"
          onChangeText={setPort}
          placeholder="9876"
          value={port}
        />

        <SetupTextField
          autoCapitalize="none"
          label="Token de emparejamiento"
          onChangeText={setToken}
          placeholder="Token mostrado en el Bridge"
          secureTextEntry
          value={token}
        />

        <SetupErrorAlert error={error} />

        <Separator className="my-1" />

        <ScannerToggleButton
          isScannerVisible={isScannerVisible}
          onPress={handleToggleScanner}
        />

        <SetupQrScanner
          isBusy={isLoading}
          isOpen={isScannerVisible}
          onClose={handleCloseScanner}
          onScan={handleQrScan}
        />

        <PairButton isLoading={isLoading} onPress={handlePair} />
      </Card.Body>
    </Card>
  );
}

/** Renders the setup screen interface. */
export function SetupScreen(props: Readonly<SetupScreenProps>) {
  const {
    error,
    ip,
    isLoading,
    isScannerVisible,
    port,
    token,
    setIp,
    setPort,
    setToken,
    handleCloseScanner,
    handlePair,
    handleQrScan,
    handleToggleScanner,
  } = useSetupScreen(props);

  return (
    <View className="flex-1 justify-center bg-background px-6">
      <SetupHeader />

      <SetupCredentialsCard
        error={error}
        handleCloseScanner={handleCloseScanner}
        handlePair={handlePair}
        handleQrScan={handleQrScan}
        handleToggleScanner={handleToggleScanner}
        ip={ip}
        isLoading={isLoading}
        isScannerVisible={isScannerVisible}
        port={port}
        setIp={setIp}
        setPort={setPort}
        setToken={setToken}
        token={token}
      />

      <AppText className="mt-6 text-center text-xs text-muted">
        También puedes usar el deep link autoreas-mobile://pair?v=1 desde el Bridge.
      </AppText>
    </View>
  );
}

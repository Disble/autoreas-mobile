export type SetupScreenProps = Record<never, never>;

export interface SetupScreenFormState {
  readonly ip: string;
  readonly port: string;
  readonly token: string;
}

export interface SetupScreenViewModel extends SetupScreenFormState {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly setIp: (value: string) => void;
  readonly setPort: (value: string) => void;
  readonly setToken: (value: string) => void;
  readonly handlePair: () => Promise<void>;
}

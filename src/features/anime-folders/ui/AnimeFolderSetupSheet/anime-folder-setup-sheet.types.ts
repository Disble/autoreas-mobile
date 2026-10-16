/** Defines the data contract for the guided root setup sheet. */
export interface AnimeFolderSetupSheetProps {
  readonly isOpen: boolean;
  /** "Ahora no", a swipe down or a tap outside: closes without choosing. */
  readonly onClose: () => void;
  /** "Elegir carpeta": closes the sheet and opens the system picker. */
  readonly onChoose: () => void;
}

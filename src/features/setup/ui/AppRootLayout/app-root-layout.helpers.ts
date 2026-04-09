import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import React from 'react';

/**
 * Wraps toast content in the keyboard-avoiding container required by the root provider.
 * This keeps the render-only provider callback out of the hook body while preserving layout behavior.
 */
export function renderKeyboardAvoidingWrapper(children: React.ReactNode) {
  return React.createElement(
    KeyboardAvoidingView,
    {
      behavior: 'padding',
      className: 'flex-1',
      keyboardVerticalOffset: 12,
      pointerEvents: 'box-none',
    },
    children,
  );
}

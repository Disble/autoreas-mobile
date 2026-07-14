import { cn } from 'heroui-native';
import { Text as RNText } from 'react-native';
import type { AppTextProps } from './app-text.types';

/** Renders application text with the shared font styling. */
export function AppText(props: Readonly<AppTextProps>) {
  const { className, ...restProps } = props;

  return <RNText className={cn('font-normal', className)} {...restProps} />;
}

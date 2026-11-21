import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { colors, type ColorName } from '../theme/colors';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({
  name,
  size = 24,
  color = 'onSurface',
}: {
  name: IconName;
  size?: number;
  color?: ColorName | string;
}) {
  const resolved = color in colors ? colors[color as ColorName] : color;
  return (
    <MaterialCommunityIcons name={name} size={size} color={resolved as string} accessible={false} />
  );
}

import { colorTokens } from './colorTokens';

export const colors = {
  ...colorTokens,
  status: {
    taken: colorTokens.taken,
    snooze: colorTokens.snooze,
    skip: colorTokens.skip,
  },
} as const;

export type ColorName = keyof typeof colorTokens;

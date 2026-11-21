export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Every interactive control is at least 56dp x 56dp (design.md section 4). */
export const MIN_TOUCH = 56;

export const elevation = {
  card: {
    elevation: 2,
    shadowColor: '#042B26',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  bar: {
    elevation: 8,
    shadowColor: '#042B26',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
} as const;

/** Fill the parent absolutely (replaces StyleSheet.absoluteFillObject, removed in React Native 0.88). */
export const ABS = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

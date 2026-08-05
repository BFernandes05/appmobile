// GestorMobile — Paleta de Cores
// Design premium dark/light mode

export const Colors = {
  light: {
    background: '#f8fafc',
    surface: '#ffffff',
    surfaceSecondary: '#f1f5f9',
    border: '#e2e8f0',
    text: '#0f172a',
    textSecondary: '#64748b',
    textTertiary: '#94a3b8',
    primary: '#6366f1',       // indigo
    primaryLight: '#eef2ff',
    success: '#10b981',
    successLight: '#ecfdf5',
    warning: '#f59e0b',
    warningLight: '#fffbeb',
    danger: '#ef4444',
    dangerLight: '#fef2f2',
    tabBar: '#ffffff',
    tabBarBorder: '#e2e8f0',
    card: '#ffffff',
    shadow: 'rgba(15, 23, 42, 0.08)',
  },
  dark: {
    background: '#0f172a',    // slate-900
    surface: '#1e293b',       // slate-800
    surfaceSecondary: '#334155', // slate-700
    border: '#334155',
    text: '#f1f5f9',
    textSecondary: '#94a3b8',
    textTertiary: '#64748b',
    primary: '#818cf8',       // indigo-400
    primaryLight: '#1e1b4b',
    success: '#34d399',
    successLight: '#064e3b',
    warning: '#fbbf24',
    warningLight: '#451a03',
    danger: '#f87171',
    dangerLight: '#450a0a',
    tabBar: '#1e293b',
    tabBarBorder: '#334155',
    card: '#1e293b',
    shadow: 'rgba(0, 0, 0, 0.4)',
  },
};

export type ColorScheme = typeof Colors.light;

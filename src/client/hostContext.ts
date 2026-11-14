import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { AppTool } from './api'

type Theme = 'light' | 'dark'
type DisplayMode = 'inline' | 'fullscreen' | 'pip'

export const MAX_INLINE_HEIGHT = 800

const palette = {
  light: {
    background: {
      primary: '#ffffff',
      secondary: '#f9f9f9',
      tertiary: '#f3f3f3',
      inverse: '#0d0d0d',
      ghost: 'transparent',
      info: '#e5f3ff',
      danger: '#fdecec',
      success: '#e6f6ec',
      warning: '#fff4e0',
      disabled: '#f3f3f3',
    },
    text: {
      primary: '#0d0d0d',
      secondary: '#5d5d5d',
      tertiary: '#8f8f8f',
      inverse: '#ffffff',
      ghost: '#8f8f8f',
      info: '#0169cc',
      danger: '#c62622',
      success: '#00772f',
      warning: '#a65300',
      disabled: '#b4b4b4',
    },
    border: {
      primary: 'rgb(13 13 13 / 0.15)',
      secondary: 'rgb(13 13 13 / 0.1)',
      tertiary: 'rgb(13 13 13 / 0.05)',
      inverse: 'rgb(255 255 255 / 0.25)',
      ghost: 'transparent',
      info: '#0285ff',
      danger: '#e02e2a',
      success: '#04b84c',
      warning: '#e25507',
      disabled: 'rgb(13 13 13 / 0.05)',
    },
    ring: {
      primary: '#0d0d0d',
      secondary: '#8f8f8f',
      inverse: '#ffffff',
      info: '#0285ff',
      danger: '#e02e2a',
      success: '#04b84c',
      warning: '#e25507',
    },
  },
  dark: {
    background: {
      primary: '#212121',
      secondary: '#303030',
      tertiary: '#414141',
      inverse: '#ffffff',
      ghost: 'transparent',
      info: '#013566',
      danger: '#4d100e',
      success: '#00381a',
      warning: '#4a2206',
      disabled: '#303030',
    },
    text: {
      primary: '#ffffff',
      secondary: '#afafaf',
      tertiary: '#8f8f8f',
      inverse: '#0d0d0d',
      ghost: '#8f8f8f',
      info: '#66b5ff',
      danger: '#ff8583',
      success: '#40c977',
      warning: '#ffa64d',
      disabled: '#5d5d5d',
    },
    border: {
      primary: 'rgb(255 255 255 / 0.2)',
      secondary: 'rgb(255 255 255 / 0.15)',
      tertiary: 'rgb(255 255 255 / 0.08)',
      inverse: 'rgb(13 13 13 / 0.25)',
      ghost: 'transparent',
      info: '#0285ff',
      danger: '#e02e2a',
      success: '#04b84c',
      warning: '#e25507',
      disabled: 'rgb(255 255 255 / 0.08)',
    },
    ring: {
      primary: '#ffffff',
      secondary: '#8f8f8f',
      inverse: '#0d0d0d',
      info: '#0285ff',
      danger: '#e02e2a',
      success: '#04b84c',
      warning: '#e25507',
    },
  },
}

const shared = {
  '--font-sans': 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  '--font-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  '--font-weight-normal': '400',
  '--font-weight-medium': '500',
  '--font-weight-semibold': '600',
  '--font-weight-bold': '700',
  '--font-text-xs-size': '12px',
  '--font-text-sm-size': '14px',
  '--font-text-md-size': '16px',
  '--font-text-lg-size': '18px',
  '--font-heading-xs-size': '14px',
  '--font-heading-sm-size': '16px',
  '--font-heading-md-size': '18px',
  '--font-heading-lg-size': '20px',
  '--font-heading-xl-size': '24px',
  '--font-heading-2xl-size': '28px',
  '--font-heading-3xl-size': '36px',
  '--font-text-xs-line-height': '18px',
  '--font-text-sm-line-height': '20px',
  '--font-text-md-line-height': '24px',
  '--font-text-lg-line-height': '28px',
  '--font-heading-xs-line-height': '20px',
  '--font-heading-sm-line-height': '24px',
  '--font-heading-md-line-height': '26px',
  '--font-heading-lg-line-height': '28px',
  '--font-heading-xl-line-height': '32px',
  '--font-heading-2xl-line-height': '34px',
  '--font-heading-3xl-line-height': '40px',
  '--border-radius-xs': '4px',
  '--border-radius-sm': '6px',
  '--border-radius-md': '8px',
  '--border-radius-lg': '12px',
  '--border-radius-xl': '16px',
  '--border-radius-full': '9999px',
  '--border-width-regular': '1px',
  '--shadow-hairline': '0 0 0 1px rgb(13 13 13 / 0.08)',
  '--shadow-sm': '0 1px 2px rgb(0 0 0 / 0.08)',
  '--shadow-md': '0 4px 12px rgb(0 0 0 / 0.1)',
  '--shadow-lg': '0 12px 32px rgb(0 0 0 / 0.16)',
}

export function styleVariables(theme: Theme) {
  const colors = Object.entries(palette[theme]).flatMap(([group, shades]) =>
    Object.entries(shades).map(([shade, value]) => [`--color-${group}-${shade}`, value]),
  )
  return { ...Object.fromEntries(colors), ...shared } as NonNullable<NonNullable<McpUiHostContext['styles']>['variables']>
}

export function hostContextFor(theme: Theme, displayMode: DisplayMode, locale: string, callId: string, tool: AppTool): McpUiHostContext {
  return {
    toolInfo: { id: callId, tool: { name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema as never } },
    theme,
    styles: { variables: styleVariables(theme) },
    displayMode,
    availableDisplayModes: ['inline', 'fullscreen', 'pip'],
    containerDimensions: { maxHeight: MAX_INLINE_HEIGHT },
    locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: 'chatgpt-app-emulator',
    platform: 'web',
    deviceCapabilities: { hover: true, touch: false },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }
}

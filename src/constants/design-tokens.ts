/**
 * BMS — Modern Minimal design tokens (Phase 1).
 *
 * Single source of truth for colour, type, spacing, radius and layout
 * dimensions used by the redesigned UI.
 *
 * IMPORTANT — this file is ADDITIVE. It does not modify, replace or shadow
 * `src/constants/theme.ts`, which remains in place for the Expo template
 * components (`themed-text`, `themed-view`, `app-tabs`). Both files can be
 * imported side by side during the Phase 2 migration; nothing here is wired
 * into a screen yet.
 *
 * Naming note: `theme.ts` already exports `Colors`, `Spacing` and `Fonts`.
 * To avoid an ambiguous double import, this file exports `DesignColors`,
 * `Space`, `TypeScale` and `Radii` instead. There is deliberately no
 * deep-import alias for either module.
 *
 * Values were derived from the colours, font sizes, weights and radii already
 * used across `src/app/*.tsx` so that adopting tokens in Phase 2 is a visual
 * no-op wherever the current styling was already correct.
 */

/* -------------------------------------------------------------------------- */
/* Colour                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Raw palette. Use `DesignColors` (below) in screens — the semantic layer
 * survives a palette change; these raw values do not.
 */
export const Palette = {
  /** Professional blood-red: primary actions, active states, brand. */
  red600: '#DC2626',
  /** Pressed/darker primary. ~6.4:1 on white — safe for body text. */
  red700: '#B91C1C',
  /** Deep red for headings and high-contrast text on light backgrounds. */
  red800: '#991B1B',
  /** Soft red wash used behind selected/prominent surfaces. */
  red50: '#FFF5F5',
  /** Red-tinted card border / hairline. */
  red200: '#FECACA',

  white: '#FFFFFF',
  /** App canvas — very light grey. */
  grey50: '#F9FAFB',
  /** Muted surface (inputs, inactive chips). */
  grey100: '#F3F4F6',
  /** Default border / divider. */
  grey200: '#E5E7EB',
  /** Stronger border (focused input, emphasised card edge). */
  grey300: '#D1D5DB',
  /** Disabled text, placeholders. */
  grey400: '#9CA3AF',
  /** Muted / secondary text. */
  grey500: '#6B7280',
  /** Body text on light surfaces. */
  grey600: '#4B5563',
  /** Emphasised body / label text. */
  grey700: '#374151',
  /** Headings — dark charcoal. */
  grey900: '#111827',

  /** Restrained success green (completion, "open", positive status). */
  green700: '#15803D',
  /** Deep green for small success text on light backgrounds. */
  green800: '#166534',
  /** Success surface. */
  green50: '#F0FDF4',
  /** Success border. */
  green200: '#BBF7D0',

  /** Amber used by the existing "service not available" notices. */
  amber700: '#92400E',
  amber50: '#FEF3C7',
  amber200: '#FDE68A',
} as const;

/**
 * Semantic colour tokens. Prefer these in screens and components.
 */
export const DesignColors = {
  /** Primary brand / action colour (filled buttons, active tab, links). */
  primary: Palette.red600,
  /** Pressed state, or primary text that must meet AA on white. */
  primaryStrong: Palette.red700,
  /** Headings and high-contrast emphasis on light surfaces. */
  primaryDeep: Palette.red800,
  /** Tinted background behind primary content. */
  primarySoft: Palette.red50,
  /** Border for tinted primary surfaces. */
  primaryBorder: Palette.red200,

  /** App canvas behind cards. */
  background: Palette.grey50,
  /** Card / sheet / header surface. */
  surface: Palette.white,
  /** Secondary surface: inputs, chips, inline notices. */
  surfaceMuted: Palette.grey100,

  /** Default text — dark charcoal. */
  text: Palette.grey900,
  /** Secondary body text. */
  textSecondary: Palette.grey700,
  /** Muted / supporting text. */
  textMuted: Palette.grey500,
  /** Disabled text and placeholders. */
  textDisabled: Palette.grey400,
  /** Text on primary / dark fills. */
  textOnPrimary: Palette.white,

  /** Default border and divider. */
  border: Palette.grey200,
  /** Emphasised border (focused field, selected card). */
  borderStrong: Palette.grey300,

  /** Success — completion and positive status. */
  success: Palette.green700,
  /** Success text on light backgrounds. */
  successText: Palette.green800,
  /** Success surface. */
  successSurface: Palette.green50,
  /** Success border. */
  successBorder: Palette.green200,

  /** Error / destructive. */
  error: Palette.red700,
  /** Error text. */
  errorText: Palette.red800,
  /** Error surface. */
  errorSurface: Palette.red50,
  /** Error border. */
  errorBorder: Palette.red200,

  /** Warning — existing gated-service notices. */
  warning: Palette.amber700,
  warningSurface: Palette.amber50,
  warningBorder: Palette.amber200,

  /** Fully transparent (pressed / elevation placeholders). */
  transparent: 'transparent',
} as const;

export type DesignColorName = keyof typeof DesignColors;
export type DesignColor = (typeof DesignColors)[DesignColorName];

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

/** Font sizes in points, matched to the sizes already in use. */
export const TypeScale = {
  caption: 12,
  footnote: 13,
  small: 14,
  /** Default body size across the app. */
  body: 15,
  bodyLarge: 16,
  label: 17,
  subtitle: 18,
  title: 20,
  heading: 24,
  display: 28,
  hero: 32,
  displayLarge: 40,
} as const;

export type TypeScaleName = keyof typeof TypeScale;

/** Font weights. `bold` is kept as an alias for the RN keyword. */
export const FontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type FontWeightName = keyof typeof FontWeight;

/**
 * Composed text presets. Spread into a style object:
 * `{ ...TextStyles.h1, color: DesignColors.text }`.
 */
export const TextStyles = {
  h1: {
    fontSize: TypeScale.display,
    fontWeight: FontWeight.bold,
    lineHeight: 36,
  },
  h2: {
    fontSize: TypeScale.heading,
    fontWeight: FontWeight.bold,
    lineHeight: 32,
  },
  h3: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: TypeScale.subtitle,
    fontWeight: FontWeight.semibold,
    lineHeight: 26,
  },
  body: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.regular,
    lineHeight: 22,
  },
  bodyStrong: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
  },
  bodyLarge: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.regular,
    lineHeight: 24,
  },
  label: {
    fontSize: TypeScale.label,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
  },
  small: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.regular,
    lineHeight: 20,
  },
  caption: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.medium,
    lineHeight: 16,
  },
  button: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.bold,
    lineHeight: 22,
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Spacing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 4pt spacing scale. Named `Space` to avoid colliding with the template's
 * `Spacing` export in `theme.ts`.
 */
export const Space = {
  none: 0,
  /** 2 — hairline gaps inside a single element. */
  xxs: 2,
  /** 4 */
  xs: 4,
  /** 8 — icon/label gaps, tight stacks. */
  sm: 8,
  /** 12 */
  md: 12,
  /** 16 — default screen padding and card padding. */
  lg: 16,
  /** 20 */
  xl: 20,
  /** 24 — section gaps, screen gutters. */
  xxl: 24,
  /** 32 — between major sections. */
  xxxl: 32,
  /** 48 — bottom clearance above a tab bar. */
  huge: 48,
  /** 64 — large hero spacing. */
  giant: 64,
} as const;

export type SpaceName = keyof typeof Space;

/* -------------------------------------------------------------------------- */
/* Border radius                                                               */
/* -------------------------------------------------------------------------- */

/** Radii matched to the values already in use (9, 10, 12, 16 dominate). */
export const Radii = {
  none: 0,
  /** 4 — chips, badges. */
  xs: 4,
  /** 8 — inputs, small buttons. */
  sm: 8,
  /** 10 — buttons. */
  md: 10,
  /** 12 — cards. */
  lg: 12,
  /** 16 — sheets, large cards. */
  xl: 16,
  /** 999 — pills; RN clamps to half the dimension. */
  full: 999,
} as const;

export type RadiiName = keyof typeof Radii;

/* -------------------------------------------------------------------------- */
/* Layout dimensions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fixed dimensions shared by screens and the navigation shell.
 *
 * `Layout.tabBarHeight` is the *visual* bar height. Screens that sit inside a
 * tab navigator must add the bottom safe-area inset on top of it; prefer
 * `useSafeAreaInsets()` over hardcoding a device inset.
 */
export const Layout = {
  /** Minimum touch target height (WCAG 2.5.5 / platform guidance). */
  minTouchTarget: 48,
  /** Default height for a primary/secondary button. */
  buttonHeight: 48,
  /** Input field height. */
  inputHeight: 48,
  /** Visual height of the bottom tab bar, excluding the safe-area inset. */
  tabBarHeight: 56,
  /** Tab bar icon size. */
  tabBarIconSize: 24,
  /** Avatar / profile photo diameter on dashboards. */
  avatarLarge: 110,
  /** Border width for cards and inputs. */
  hairline: 1,
  /** Reads well on phones and tablets. */
  maxContentWidth: 720,
} as const;

/* -------------------------------------------------------------------------- */
/* Elevation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shadows are intentionally restrained. Android uses `elevation` only, so both
 * keys are provided; apply per platform in the component.
 */
export const Shadows = {
  none: {
    shadowColor: DesignColors.transparent,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  card: {
    shadowColor: Palette.grey900,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: Palette.grey900,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Convenience aggregate                                                       */
/* -------------------------------------------------------------------------- */

/** Grouped export for `import { Tokens } from '@/constants/design-tokens'`. */
export const Tokens = {
  colors: DesignColors,
  palette: Palette,
  type: TypeScale,
  weight: FontWeight,
  text: TextStyles,
  space: Space,
  radii: Radii,
  layout: Layout,
  shadows: Shadows,
} as const;

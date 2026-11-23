import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '@/constants/design-tokens';

/**
 * Shared action button (Phase 2 redesign).
 *
 * Variants are a deliberate 2×2 of {filled, outlined} × {neutral, danger} so the
 * four styles stay visually distinct even though the brand colour is red:
 * - `primary`     filled brand red  → the single main action on a screen
 * - `secondary`   filled neutral    → supporting action next to a primary one
 * - `outline`     outlined neutral  → low-emphasis / "open details" action
 * - `destructive` outlined danger   → reject / remove; outlined so it is never
 *   confused with `primary`, and matching the existing outlined red "Reject"
 *   affordance already used by the Admin screens.
 *
 * Only design tokens from `design-tokens.ts` are used. No screen is wired to
 * this component yet.
 */
export type AppButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive';

export type AppButtonProps = {
  /** Visible button text. Also used as the accessibility label unless overridden. */
  label: string;
  onPress?: () => void;
  variant?: AppButtonVariant;
  /** Shows a spinner, blocks presses and reports `busy` to assistive technology. */
  loading?: boolean;
  disabled?: boolean;
  /** Override the spoken label (e.g. include the row's item name). */
  accessibilityLabel?: string;
  /** Layout overrides only (e.g. `{ alignSelf: 'stretch' }`). */
  style?: StyleProp<ViewStyle>;
};

/** Variant-specific colours, resolved once rather than inline in render. */
const VARIANT_STYLES: Record<
  AppButtonVariant,
  { container: ViewStyle; pressed: ViewStyle; labelColor: string; spinnerColor: string }
> = {
  primary: {
    container: { backgroundColor: DesignColors.primary, borderColor: DesignColors.primary },
    pressed: { backgroundColor: DesignColors.primaryStrong, borderColor: DesignColors.primaryStrong },
    labelColor: DesignColors.textOnPrimary,
    spinnerColor: DesignColors.textOnPrimary,
  },
  secondary: {
    container: { backgroundColor: DesignColors.surfaceMuted, borderColor: DesignColors.surfaceMuted },
    pressed: { backgroundColor: DesignColors.border, borderColor: DesignColors.border },
    labelColor: DesignColors.text,
    spinnerColor: DesignColors.text,
  },
  outline: {
    container: { backgroundColor: DesignColors.surface, borderColor: DesignColors.borderStrong },
    pressed: { backgroundColor: DesignColors.surfaceMuted, borderColor: DesignColors.borderStrong },
    labelColor: DesignColors.textSecondary,
    spinnerColor: DesignColors.textSecondary,
  },
  destructive: {
    container: { backgroundColor: DesignColors.surface, borderColor: DesignColors.errorBorder },
    pressed: { backgroundColor: DesignColors.errorSurface, borderColor: DesignColors.errorBorder },
    labelColor: DesignColors.errorText,
    spinnerColor: DesignColors.errorText,
  },
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: AppButtonProps) {
  // A loading button must also be non-interactive, so both states share one guard.
  const isDisabled = disabled || loading;
  const palette = VARIANT_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={() => {
        if (isDisabled) return;
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        palette.container,
        pressed && !isDisabled && palette.pressed,
        // Only an explicit `disabled` greys the button out; `loading` keeps the
        // variant colours so the action still reads as the same button.
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading && (
        <ActivityIndicator size="small" color={disabled ? DesignColors.textMuted : palette.spinnerColor} />
      )}
      <Text
        // `textMuted` (~4.8:1 on the muted surface) rather than `textDisabled`
        // so a disabled label is still readable, not just technically inactive.
        style={[styles.label, { color: disabled ? DesignColors.textMuted : palette.labelColor }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // Row + centred so an optional spinner sits beside the label without reflow.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: Layout.buttonHeight,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderWidth: Layout.hairline,
    borderRadius: Radii.md,
  },
  /** Neutral, unambiguous disabled appearance rather than a faded brand colour. */
  disabled: {
    backgroundColor: DesignColors.surfaceMuted,
    borderColor: DesignColors.border,
  },
  label: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.bold,
    lineHeight: 22,
    textAlign: 'center',
    flexShrink: 1,
  },
});

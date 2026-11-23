import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  DesignColors,
  Layout,
  Radii,
  Shadows,
  Space,
} from '@/constants/design-tokens';

/**
 * Shared white surface card (Phase 2 redesign).
 *
 * Use a plain card for static content. Pass `onPress` only when the whole card
 * is genuinely an action target (e.g. a selectable item) — otherwise put a
 * button or a `ListRow` inside a static card. This keeps the touch target and
 * the accessibility role honest.
 */
export type AppCardProps = {
  children: ReactNode;
  /** Makes the card pressable and exposes it to assistive technology as a button. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout overrides only (e.g. `{ flex: 1 }`); padding/colour stay token-driven. */
  style?: StyleProp<ViewStyle>;
};

export function AppCard({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
}: AppCardProps) {
  if (!onPress) {
    return (
      <View style={[styles.card, style]}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: DesignColors.surface,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.border,
    borderRadius: Radii.lg,
    padding: Space.lg,
    ...Shadows.card,
  },
  /** Subtle press feedback; keeps text contrast unchanged. */
  pressed: {
    backgroundColor: DesignColors.surfaceMuted,
  },
});

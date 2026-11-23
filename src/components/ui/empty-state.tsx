import type { ReactNode } from 'react';
import type { SymbolViewProps } from 'expo-symbols';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import {
  DesignColors,
  FontWeight,
  Radii,
  Space,
  TypeScale,
} from '@/constants/design-tokens';

/**
 * Symbol name accepted by `expo-symbols`: either one SF Symbol string or a
 * per-platform object. Taken from the installed package so no new dependency
 * (e.g. `sf-symbols-typescript`) has to be imported directly.
 */
export type EmptyStateIcon = SymbolViewProps['name'];

/**
 * Shared empty / error / "nothing here yet" state (Phase 2 redesign).
 *
 * Used both for genuinely empty lists and for the states a screen reaches when
 * data could not be loaded — the caller decides the wording so no message is
 * invented here. `action` is rendered as-is so the caller can pass an
 * `AppButton` with the correct behaviour (retry, go to login, …).
 */
export type EmptyStateProps = {
  /** Short, specific heading, e.g. "No pending donors". */
  title: string;
  /** One or two sentences of explanation or next step. */
  description?: string;
  /** Optional leading symbol, e.g. `{ ios: 'tray', android: 'inbox', web: 'inbox' }`. */
  icon?: EmptyStateIcon;
  /** Optional action, typically an `AppButton`. */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({ title, description, icon, action, style }: EmptyStateProps) {
  return (
    <View style={[styles.container, style]} accessibilityLiveRegion="polite">
      {icon && (
        <View style={styles.iconCircle} accessible={false}>
          <SymbolView
            name={icon}
            size={24}
            tintColor={DesignColors.textMuted}
          />
        </View>
      )}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {description !== undefined && description !== '' && (
        <Text style={styles.description}>{description}</Text>
      )}
      {action !== undefined && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingVertical: Space.xxl,
    paddingHorizontal: Space.lg,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.surfaceMuted,
    marginBottom: Space.xs,
  },
  title: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
    color: DesignColors.text,
    textAlign: 'center',
  },
  description: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.regular,
    lineHeight: 20,
    color: DesignColors.textMuted,
    textAlign: 'center',
  },
  action: {
    marginTop: Space.sm,
    alignSelf: 'stretch',
  },
});

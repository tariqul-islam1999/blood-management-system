import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '@/constants/design-tokens';

/**
 * Shared list row (Phase 2 redesign).
 *
 * One row = optional leading visual (or `initials` avatar) + title + optional
 * subtitle + optional trailing content. Pass `onPress` to make the whole row
 * the tap target; when a row is pressable and has no `trailing` content, a
 * chevron is shown so the affordance is visible.
 *
 * Rows are intended to sit inside an `AppCard` or a bordered list container —
 * this component deliberately has no border or background of its own so it does
 * not double up the card styling.
 */
export type ListRowProps = {
  title: string;
  /** Single line of supporting text. Two lines are allowed before truncation. */
  subtitle?: string;
  /** Any leading visual, e.g. an icon or a badge. Ignored when `initials` is set. */
  leading?: ReactNode;
  /** Renders a token-styled circular avatar with these initials instead of `leading`. */
  initials?: string;
  /** Right-hand content, e.g. a `StatusBadge`. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Override the spoken label; defaults to "title, subtitle". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Divides the row from the row below inside a grouped list. */
  showDivider?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** First letters of up to two words, upper-cased. Returns '' for blank input. */
function toInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '';
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

export function ListRow({
  title,
  subtitle,
  leading,
  initials,
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  showDivider = false,
  style,
}: ListRowProps) {
  const avatarInitials = initials === undefined ? '' : toInitials(initials);
  // Treat `null` like "not provided" so callers can pass a conditional value.
  const hasTrailing = trailing !== undefined && trailing !== null;
  // Only show the chevron for pressable rows that have no trailing content.
  const showChevron = onPress !== undefined && !hasTrailing;

  const content = (
    <>
      {avatarInitials !== '' ? (
        <View style={styles.avatar} accessible={false}>
          <Text style={styles.avatarText}>{avatarInitials}</Text>
        </View>
      ) : (
        leading
      )}
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        {subtitle !== undefined && subtitle !== '' && (
          <Text style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
            {subtitle}
          </Text>
        )}
      </View>
      {hasTrailing && <View style={styles.trailing}>{trailing}</View>}
      {showChevron && (
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={16}
          tintColor={DesignColors.textMuted}
        />
      )}
    </>
  );

  const containerStyle = [styles.row, showDivider && styles.divider, style];

  if (!onPress) {
    return <View style={containerStyle}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (typeof subtitle === 'string' && subtitle !== '' ? `${title}, ${subtitle}` : title)
      }
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [containerStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: Layout.minTouchTarget,
    paddingVertical: Space.md,
  },
  divider: {
    borderBottomWidth: Layout.hairline,
    borderBottomColor: DesignColors.border,
  },
  pressed: {
    opacity: 0.65,
  },
  textBlock: {
    flex: 1,
    gap: Space.xxs,
  },
  title: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
    color: DesignColors.text,
  },
  subtitle: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.regular,
    lineHeight: 20,
    color: DesignColors.textMuted,
  },
  trailing: {
    flexShrink: 0,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },
  avatarText: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.bold,
    color: DesignColors.primaryDeep,
  },
});

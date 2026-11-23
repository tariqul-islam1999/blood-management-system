import { Tabs } from 'expo-router/tabs';
import { SymbolView } from 'expo-symbols';

import { DesignColors, Layout, Space } from '../../constants/design-tokens';

/**
 * Super Admin navigation: a single Home tab.
 *
 * Only one Super Admin screen exists, so no placeholder tabs are added. Donor
 * verification is reached from the dashboard's action button, which keeps the
 * existing `/admin-dashboard` route and role behaviour unchanged.
 *
 * Styling matches the Admin tabs: token colours, `Layout.tabBarHeight` and
 * `expo-symbols` icons with the per-platform name object.
 */
export default function SuperAdminTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: DesignColors.primary,
        tabBarInactiveTintColor: DesignColors.textMuted,
        tabBarStyle: {
          backgroundColor: DesignColors.surface,
          borderTopColor: DesignColors.border,
          borderTopWidth: Layout.hairline,
          height: Layout.tabBarHeight,
          paddingTop: Space.xs,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          paddingVertical: Space.xxs,
        },
      }}
    >
      <Tabs.Screen
        name="super-admin-dashboard"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          tabBarAccessibilityLabel: 'Super Admin home',
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? 'shield.lefthalf.filled' : 'shield',
                android: 'shield',
                web: 'shield',
              }}
              size={Layout.tabBarIconSize}
              tintColor={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

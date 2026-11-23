import { Tabs } from 'expo-router/tabs';
import { SymbolView } from 'expo-symbols';

import { DesignColors, Layout, Space } from '../../constants/design-tokens';

/**
 * Admin bottom navigation: Home + Verification.
 *
 * Both destinations are implemented screens, so neither tab is a placeholder.
 * Feature areas that have no screen or backend (User management, Blood request
 * management) deliberately get no tab.
 *
 * `admin-dashboard` is declared first so `/admin-dashboard` remains the group's
 * entry point — that is the URL `src/app/login.tsx` already redirects admins to.
 * `login.tsx` and the root `_layout.tsx` are unchanged, so every existing Admin
 * route and deep link keeps working.
 *
 * Icons come from `expo-symbols` (already installed). The per-platform object
 * form is used because that package resolves iOS vs Android/web from it; on
 * web it renders the same material glyph as Android.
 */
export default function AdminTabsLayout() {
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
        // Keeps icons/labels centred and tappable on small screens.
        tabBarItemStyle: {
          paddingVertical: Space.xxs,
        },
      }}
    >
      <Tabs.Screen
        name="admin-dashboard"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          tabBarAccessibilityLabel: 'Home dashboard',
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? 'house.fill' : 'house',
                android: 'home',
                web: 'home',
              }}
              size={Layout.tabBarIconSize}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="admin-verification"
        options={{
          title: 'Verification',
          tabBarLabel: 'Verification',
          tabBarAccessibilityLabel: 'Donor verification',
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? 'checkmark.shield.fill' : 'checkmark.shield',
                android: 'verified_user',
                web: 'verified_user',
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

import { Tabs } from 'expo-router/tabs';
import { SymbolView } from 'expo-symbols';

import { DesignColors, Layout, Space } from '../../constants/design-tokens';

/**
 * Beneficiary navigation: Home, Create Request, My Requests.
 *
 * `find-donors` keeps `href: null` so it stays reachable from the dashboard
 * button and by deep link but does not appear as a tab.
 *
 * Icons come from `expo-symbols` (already installed) using the same
 * per-platform object form and `Layout.tabBarIconSize` as the Donor, Admin and
 * Super Admin tabs. Without an explicit `tabBarIcon`, React Navigation renders
 * its placeholder glyph, which appears as a square box on Android.
 */
export default function BeneficiaryTabsLayout() {
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
        name="beneficiary-dashboard"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          tabBarAccessibilityLabel: 'Beneficiary home',
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
        name="create-blood-request"
        options={{
          title: 'Create Request',
          tabBarLabel: 'Create Request',
          tabBarAccessibilityLabel: 'Create blood request',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'plus.circle',
                android: 'add_circle',
                web: 'add_circle',
              }}
              size={Layout.tabBarIconSize}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="my-blood-requests"
        options={{
          title: 'My Requests',
          tabBarLabel: 'My Requests',
          tabBarAccessibilityLabel: 'My blood requests',
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? 'list.bullet.rectangle.fill' : 'list.bullet.rectangle',
                android: 'receipt_long',
                web: 'receipt_long',
              }}
              size={Layout.tabBarIconSize}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="find-donors"
        options={{ href: null, title: 'Find Donors', headerShown: true }}
      />
    </Tabs>
  );
}

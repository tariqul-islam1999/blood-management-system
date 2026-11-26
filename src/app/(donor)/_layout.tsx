import { Tabs } from 'expo-router/tabs';
import { SymbolView } from 'expo-symbols';

import { DesignColors, Layout, Space } from '../../constants/design-tokens';

/**
 * Donor navigation: Home, Requests and History tabs, plus two non-tab routes.
 *
 * `active-donation` and `donation-followup` keep `href: null` so they remain
 * reachable by deep link/params but do not appear as tabs — an active donation
 * is entered from an accepted request, not from the tab bar.
 *
 * Styling matches the Admin and Super Admin tabs: token colours,
 * `Layout.tabBarHeight` and `expo-symbols` icons.
 */
export default function DonorTabsLayout() {
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
        name="donor-dashboard"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          tabBarAccessibilityLabel: 'Donor home',
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
        name="open-blood-requests"
        options={{
          title: 'Requests',
          tabBarLabel: 'Requests',
          tabBarAccessibilityLabel: 'Open blood requests',
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? 'drop.fill' : 'drop',
                android: 'bloodtype',
                web: 'bloodtype',
              }}
              size={Layout.tabBarIconSize}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="donation-history"
        options={{
          title: 'History',
          tabBarLabel: 'History',
          tabBarAccessibilityLabel: 'Donation history',
          tabBarIcon: ({ color, focused }) => (
            <SymbolView
              name={{
                ios: focused ? 'clock.arrow.circlepath' : 'clock',
                android: 'history',
                web: 'history',
              }}
              size={Layout.tabBarIconSize}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="active-donation"
        options={{ href: null, title: 'Active Donation', headerShown: true }}
      />
      <Tabs.Screen
        name="donation-followup"
        options={{ href: null, title: 'Donation Follow-up', headerShown: true }}
      />
    </Tabs>
  );
}

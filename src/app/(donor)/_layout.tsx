import { Tabs } from 'expo-router/tabs';
import { DesignColors } from '../../constants/design-tokens';

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
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="donor-dashboard"
        options={{ title: 'Home', tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="open-blood-requests"
        options={{ title: 'Requests', tabBarLabel: 'Requests' }}
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

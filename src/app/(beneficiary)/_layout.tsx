import { Tabs } from 'expo-router/tabs';
import { DesignColors } from '../../constants/design-tokens';

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
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="beneficiary-dashboard"
        options={{ title: 'Home', tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="create-blood-request"
        options={{ title: 'Create Request', tabBarLabel: 'Create Request' }}
      />
      <Tabs.Screen
        name="my-blood-requests"
        options={{ title: 'My Requests', tabBarLabel: 'My Requests' }}
      />
      <Tabs.Screen
        name="find-donors"
        options={{ href: null, title: 'Find Donors', headerShown: true }}
      />
    </Tabs>
  );
}

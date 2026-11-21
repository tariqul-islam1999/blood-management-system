import { Tabs } from 'expo-router/tabs';
import { DesignColors } from '../../constants/design-tokens';

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
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="super-admin-dashboard"
        options={{ title: 'Home', tabBarLabel: 'Home' }}
      />
    </Tabs>
  );
}

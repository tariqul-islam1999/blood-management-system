
import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { useColorScheme } from 'react-native';
import '../global.css';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider
      value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}
    >
      <Stack screenOptions={{ headerTransparent: false }}>
        <Stack.Screen
          name="index"
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="login"
          options={{ title: 'Login' }}
        />

<Stack.Screen
  name="register"
  options={{ title: 'Create Account' }}
/>

      </Stack>
    </ThemeProvider>
  );
}


import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase environment variables are missing.');
}

// Static web rendering runs in Node, where browser storage is unavailable.
// Native and browser clients retain their existing persisted sessions.
const isWebServer = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: isWebServer ? undefined : AsyncStorage,
    autoRefreshToken: !isWebServer,
    persistSession: !isWebServer,
    detectSessionInUrl: false,
  },
});

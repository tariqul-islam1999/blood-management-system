import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useFocusEffect, useRouter } from 'expo-router';

import {
  BLOOD_GROUPS,
  BLOOD_REQUEST_SERVICE_ACTIVE,
  BLOOD_REQUEST_SERVICE_MESSAGE,
  BloodRequestError,
  beneficiaryCreateBloodRequest,
  validateCreateBloodRequest,
  verifyBloodRequestAccess,
} from '../lib/blood-requests';

export default function CreateBloodRequestScreen() {
  const router = useRouter();
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [bloodGroup, setBloodGroup] = useState('');
  const [units, setUnits] = useState('1');
  const [urgency, setUrgency] = useState<'routine' | 'urgent'>('routine');
  const [neededBy, setNeededBy] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkAccess = useCallback(async () => {
    setIsCheckingAccess(true);
    setAccessError(null);
    try {
      await verifyBloodRequestAccess('beneficiary');
    } catch (error) {
      const message = error instanceof BloodRequestError ? error.message : 'Unable to verify your account.';
      setAccessError(message);
      if (error instanceof BloodRequestError && error.code === 'expired') router.replace('/login');
    } finally {
      setIsCheckingAccess(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => {
    void checkAccess();
  }, [checkAccess]));

  const submit = async () => {
    if (isSubmitting || !BLOOD_REQUEST_SERVICE_ACTIVE) return;
    const unitCount = Number(units);
    const validation = validateCreateBloodRequest(bloodGroup, unitCount, urgency, neededBy);
    if (validation) {
      Alert.alert('Check Request Details', validation);
      return;
    }
    setIsSubmitting(true);
    try {
      await beneficiaryCreateBloodRequest(bloodGroup as (typeof BLOOD_GROUPS)[number], unitCount, urgency, neededBy);
      Alert.alert('Blood Request Created', 'Your request was created successfully.', [
        { text: 'View My Requests', onPress: () => router.replace('/my-blood-requests' as Href) },
      ]);
    } catch (error) {
      Alert.alert('Request Not Created', error instanceof Error ? error.message : 'Unable to create the request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAccess) return <Loading label="Checking your account..." />;
  if (accessError) return <ErrorState message={accessError} onRetry={() => void checkAccess()} />;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create Blood Request</Text>
        <Text style={styles.description}>Your approximate location is securely copied from your profile. Do not enter contact or medical details here.</Text>
        {!BLOOD_REQUEST_SERVICE_ACTIVE ? <DisabledNotice /> : (
          <>
            <Text style={styles.label}>Blood Group *</Text>
            <View style={styles.optionGrid}>
              {BLOOD_GROUPS.map((group) => <Pressable key={group} accessibilityRole="button" accessibilityLabel={`Select ${group}`} onPress={() => setBloodGroup(group)} style={[styles.option, bloodGroup === group && styles.optionSelected]}><Text style={[styles.optionText, bloodGroup === group && styles.optionTextSelected]}>{group}</Text></Pressable>)}
            </View>
            <Text style={styles.label}>Units Required (1â€“10) *</Text>
            <TextInput value={units} onChangeText={setUnits} keyboardType="number-pad" maxLength={2} style={styles.input} accessibilityLabel="Units required" />
            <Text style={styles.label}>Urgency *</Text>
            <View style={styles.row}>
              {(['routine', 'urgent'] as const).map((value) => <Pressable key={value} onPress={() => setUrgency(value)} style={[styles.choice, urgency === value && styles.choiceSelected]} accessibilityRole="button"><Text style={[styles.choiceText, urgency === value && styles.optionTextSelected]}>{value === 'routine' ? 'Routine' : 'Urgent'}</Text></Pressable>)}
            </View>
            <Text style={styles.label}>Needed-by Date (YYYY-MM-DD) *</Text>
            <TextInput value={neededBy} onChangeText={setNeededBy} placeholder="2026-10-30" placeholderTextColor="#9CA3AF" autoCapitalize="none" style={styles.input} accessibilityLabel="Needed-by date" />
            <Text style={styles.hint}>Choose today through 90 days from today. The server validates all details again.</Text>
            <Pressable onPress={() => void submit()} disabled={isSubmitting} style={[styles.primaryButton, isSubmitting && styles.disabledButton]} accessibilityRole="button">
              {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Create Blood Request</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DisabledNotice() { return <View style={styles.notice}><Text style={styles.noticeTitle}>Service Not Available</Text><Text style={styles.noticeText}>{BLOOD_REQUEST_SERVICE_MESSAGE}</Text></View>; }
function Loading({ label }: { label: string }) { return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color="#DC2626" /><Text style={styles.loadingText}>{label}</Text></SafeAreaView>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <SafeAreaView style={styles.center}><Text style={styles.errorText}>{message}</Text><Pressable style={styles.primaryButton} onPress={onRetry}><Text style={styles.primaryButtonText}>Try Again</Text></Pressable></SafeAreaView>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5F5' }, content: { padding: 24, paddingBottom: 48 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FFF5F5' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#991B1B' }, description: { marginTop: 10, color: '#4B5563', lineHeight: 21 }, label: { marginTop: 22, marginBottom: 8, color: '#374151', fontWeight: '700' },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { minWidth: 58, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FCA5A5', alignItems: 'center' }, optionSelected: { backgroundColor: '#DC2626', borderColor: '#DC2626' }, optionText: { color: '#991B1B', fontWeight: '700' }, optionTextSelected: { color: '#FFFFFF' },
  input: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 10, padding: 14, fontSize: 16, color: '#111827' }, row: { flexDirection: 'row', gap: 10 }, choice: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#FCA5A5', alignItems: 'center', backgroundColor: '#FFFFFF' }, choiceSelected: { backgroundColor: '#DC2626', borderColor: '#DC2626' }, choiceText: { color: '#991B1B', fontWeight: '700' },
  hint: { marginTop: 8, color: '#6B7280', fontSize: 13, lineHeight: 18 }, primaryButton: { marginTop: 24, backgroundColor: '#DC2626', borderRadius: 10, padding: 15, alignItems: 'center', minHeight: 50, justifyContent: 'center' }, primaryButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 }, disabledButton: { opacity: 0.55 }, loadingText: { marginTop: 12, color: '#6B7280' }, errorText: { color: '#B91C1C', textAlign: 'center', lineHeight: 21 }, notice: { marginTop: 22, backgroundColor: '#FEF3C7', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' }, noticeTitle: { color: '#92400E', fontWeight: 'bold', fontSize: 16 }, noticeText: { color: '#92400E', marginTop: 7, lineHeight: 20 },
});

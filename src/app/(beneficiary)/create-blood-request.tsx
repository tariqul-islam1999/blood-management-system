import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppButton, AppCard, EmptyState } from '../../components/ui';
import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '../../constants/design-tokens';

import {
  BLOOD_GROUPS,
  BLOOD_REQUEST_SERVICE_ACTIVE,
  BLOOD_REQUEST_SERVICE_MESSAGE,
  BloodRequestError,
  beneficiaryCreateBloodRequest,
  validateCreateBloodRequest,
  verifyBloodRequestAccess,
} from '../../lib/blood-requests';

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

  const isDisabled = isSubmitting || !BLOOD_REQUEST_SERVICE_ACTIVE;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <View style={styles.headerIcon} accessible={false}>
            <SymbolView
              name={{ ios: 'drop', android: 'water_drop', web: 'water_drop' }}
              size={23}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Blood requests</Text>
            <Text style={styles.title} accessibilityRole="header">Create Blood Request</Text>
            <Text style={styles.description}>
              Your approximate location is securely copied from your profile. Do not enter contact or
              medical details here.
            </Text>
          </View>
        </View>

        {!BLOOD_REQUEST_SERVICE_ACTIVE ? (
          <DisabledNotice />
        ) : (
          <>
            <AppCard style={styles.formCard}>
              <Text style={styles.sectionLabel}>BLOOD GROUP</Text>
              <Text style={styles.label}>Blood Group *</Text>
              <View style={styles.optionGrid}>
                {BLOOD_GROUPS.map((group) => {
                  const selected = bloodGroup === group;
                  return (
                    <Pressable
                      key={group}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${group}`}
                      accessibilityState={{ selected, disabled: isSubmitting }}
                      disabled={isSubmitting}
                      onPress={() => setBloodGroup(group)}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        pressed && !isSubmitting && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{group}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Units Required (1{'\u2013'}10) *</Text>
              <TextInput
                value={units}
                onChangeText={setUnits}
                keyboardType="number-pad"
                maxLength={2}
                style={styles.input}
                accessibilityLabel="Units required"
                placeholderTextColor={DesignColors.textMuted}
                editable={!isSubmitting}
              />
              <Text style={styles.hint}>Enter a whole number from 1 to 10.</Text>

              <Text style={styles.label}>Urgency *</Text>
              <View style={styles.row}>
                {(['routine', 'urgent'] as const).map((value) => {
                  const selected = urgency === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setUrgency(value)}
                      accessibilityRole="button"
                      accessibilityLabel={value === 'routine' ? 'Routine urgency' : 'Urgent urgency'}
                      accessibilityState={{ selected, disabled: isSubmitting }}
                      disabled={isSubmitting}
                      style={({ pressed }) => [
                        styles.choice,
                        selected && styles.choiceSelected,
                        pressed && !isSubmitting && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.choiceText, selected && styles.optionTextSelected]}>
                        {value === 'routine' ? 'Routine' : 'Urgent'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </AppCard>

            <AppCard style={styles.formCard}>
              <Text style={styles.sectionLabel}>WHEN IT IS NEEDED</Text>
              <Text style={styles.label}>Needed-by Date (YYYY-MM-DD) *</Text>
              <TextInput
                value={neededBy}
                onChangeText={setNeededBy}
                placeholder="2026-10-30"
                placeholderTextColor={DesignColors.textMuted}
                autoCapitalize="none"
                style={styles.input}
                accessibilityLabel="Needed-by date"
                editable={!isSubmitting}
              />
              <Text style={styles.hint}>
                Choose today through 90 days from today. The server validates all details again.
              </Text>
            </AppCard>

            <AppButton
              label="Create Blood Request"
              variant="primary"
              loading={isSubmitting}
              disabled={isDisabled}
              accessibilityLabel="Create blood request"
              onPress={() => void submit()}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DisabledNotice() {
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.noticeTitle}>Service Not Available</Text>
      <Text style={styles.noticeText}>{BLOOD_REQUEST_SERVICE_MESSAGE}</Text>
    </View>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
          color={DesignColors.primary}
          accessibilityLabel="Checking your account"
        />
        <Text style={styles.centeredText}>{label}</Text>
      </View>
    </SafeAreaView>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <AppCard style={styles.fullWidth}>
          <EmptyState
            icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
            title="Access could not be verified"
            description={message}
            action={<AppButton label="Try Again" variant="primary" onPress={onRetry} />}
          />
        </AppCard>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DesignColors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.lg,
    gap: Space.md,
  },
  fullWidth: { width: '100%', maxWidth: Layout.maxContentWidth },
  content: {
    width: '100%', maxWidth: Layout.maxContentWidth, alignSelf: 'center',
    paddingHorizontal: Space.lg, paddingTop: Space.lg, paddingBottom: Space.xxxl, gap: Space.md,
  },

  header: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginBottom: Space.xs },
  headerIcon: {
    width: 48, height: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft, borderWidth: Layout.hairline, borderColor: DesignColors.primaryBorder,
  },
  headerText: { flex: 1, gap: Space.xxs },
  eyebrow: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, color: DesignColors.primary,
    textTransform: 'uppercase',
  },
  title: { fontSize: TypeScale.heading, fontWeight: FontWeight.bold, lineHeight: 30, color: DesignColors.text },
  description: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },

  formCard: { gap: Space.sm },
  sectionLabel: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, letterSpacing: 0.6,
    color: DesignColors.textMuted,
  },
  label: { fontSize: TypeScale.body, fontWeight: FontWeight.semibold, color: DesignColors.text, marginTop: Space.xs },
  hint: { fontSize: TypeScale.caption, lineHeight: 18, color: DesignColors.textMuted },

  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  option: {
    minWidth: 64, minHeight: Layout.minTouchTarget, paddingHorizontal: Space.md, paddingVertical: Space.sm,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: Radii.md, borderWidth: Layout.hairline, borderColor: DesignColors.border,
    backgroundColor: DesignColors.surface,
  },
  optionSelected: { backgroundColor: DesignColors.primarySoft, borderColor: DesignColors.primary },
  optionText: { fontSize: TypeScale.body, fontWeight: FontWeight.semibold, color: DesignColors.textSecondary },
  optionTextSelected: { fontWeight: FontWeight.bold, color: DesignColors.primaryDeep },
  pressed: { opacity: 0.72 },

  row: { flexDirection: 'row', gap: Space.sm },
  choice: {
    flex: 1, minHeight: Layout.minTouchTarget, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Space.sm, borderRadius: Radii.md,
    borderWidth: Layout.hairline, borderColor: DesignColors.border, backgroundColor: DesignColors.surface,
  },
  choiceSelected: { backgroundColor: DesignColors.primarySoft, borderColor: DesignColors.primary },
  choiceText: { fontSize: TypeScale.body, fontWeight: FontWeight.semibold, color: DesignColors.textSecondary },

  input: {
    minHeight: Layout.inputHeight, paddingHorizontal: Space.md, paddingVertical: Space.md,
    borderWidth: Layout.hairline, borderColor: DesignColors.border, borderRadius: Radii.md,
    backgroundColor: DesignColors.surface, color: DesignColors.text, fontSize: TypeScale.bodyLarge,
  },

  notice: {
    gap: Space.sm, padding: Space.md, borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder, backgroundColor: DesignColors.warningSurface,
  },
  noticeTitle: { fontSize: TypeScale.body, fontWeight: FontWeight.bold, color: DesignColors.warning },
  noticeText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.warning },
  centeredText: { fontSize: TypeScale.body, color: DesignColors.textMuted, textAlign: 'center' },
});

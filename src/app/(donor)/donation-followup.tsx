import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppButton, AppCard, EmptyState } from '../../components/ui';
import { DesignColors, FontWeight, Layout, Radii, Space, TypeScale } from '../../constants/design-tokens';

import {
  DONATION_WORKFLOW_SERVICE_ACTIVE,
  DONATION_WORKFLOW_SERVICE_MESSAGE,
  FOLLOWUP_QUESTIONS,
  FollowupAnswers,
  donorSubmitDonationFollowup,
  validateFollowupAnswers,
  verifyDonationWorkflowAccess,
} from '../../lib/donation-workflow';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);

export default function DonationFollowupScreen() {
  const params = useLocalSearchParams<{ engagement_id?: string | string[]; follow_up_due_at?: string | string[] }>();
  const engagementId = useMemo(() => {
    const raw = Array.isArray(params.engagement_id) ? params.engagement_id[0] : params.engagement_id;
    return raw ?? null;
  }, [params.engagement_id]);
  const dueAt = useMemo(() => {
    const raw = Array.isArray(params.follow_up_due_at) ? params.follow_up_due_at[0] : params.follow_up_due_at;
    return typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? raw : null;
  }, [params.follow_up_due_at]);

  const [answers, setAnswers] = useState<Partial<FollowupAnswers>>({});
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDue = dueAt === null || Date.now() >= Date.parse(dueAt);

  const answer = (key: keyof FollowupAnswers, value: string) =>
    setAnswers((current) => ({ ...current, [key]: value } as Partial<FollowupAnswers>));

  const submit = () => {
    if (isSubmitting || isSubmitted || !DONATION_WORKFLOW_SERVICE_ACTIVE || !isUuid(engagementId)) return;
    const validation = validateFollowupAnswers(answers, comments.trim());
    if (validation) {
      setError(validation);
      return;
    }
    Alert.alert(
      'Submit Follow-up?',
      'This is a general wellbeing check, not medical diagnosis or treatment advice. You can submit it once.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: () => void confirmSubmit() },
      ],
    );
  };

  const confirmSubmit = async () => {
    if (!isUuid(engagementId)) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await verifyDonationWorkflowAccess();
      await donorSubmitDonationFollowup(engagementId, answers as FollowupAnswers, comments.trim());
      setIsSubmitted(true);
      Alert.alert('Follow-up Submitted', 'Thank you. Your wellbeing responses were recorded.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit your follow-up.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isUuid(engagementId)) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <AppCard style={styles.fullWidth}>
            <EmptyState
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
              title="Follow-up unavailable"
              description="This follow-up link is invalid. Open it from your active donation."
            />
          </AppCard>
        </View>
      </SafeAreaView>
    );
  }

  const isDisabled = isSubmitting || !DONATION_WORKFLOW_SERVICE_ACTIVE;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.headerIcon} accessible={false}>
            <SymbolView
              name={{ ios: 'heart.text.square', android: 'favorite', web: 'favorite' }}
              size={23}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Donor journey</Text>
            <Text style={styles.title} accessibilityRole="header">Donation Follow-up</Text>
            <Text style={styles.description}>
              This is a general wellbeing check, not medical diagnosis or treatment advice. It becomes
              available 48 hours after you reached home safely and can be submitted once.
            </Text>
          </View>
        </View>

        {!DONATION_WORKFLOW_SERVICE_ACTIVE && <Notice />}

        {error !== null && (
          <View style={styles.errorNotice} accessibilityLiveRegion="polite">
            <SymbolView
              name={{ ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }}
              size={18}
              tintColor={DesignColors.errorText}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {isSubmitted ? (
          <AppCard style={styles.stateCard}>
            <View style={styles.stateIconSuccess} accessible={false}>
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={22}
                tintColor={DesignColors.successText}
              />
            </View>
            <Text style={styles.cardTitle} accessibilityRole="header">Follow-up recorded</Text>
            <Text style={styles.supportingText}>Thank you. Your wellbeing responses have been submitted.</Text>
          </AppCard>
        ) : !isDue ? (
          <AppCard style={styles.stateCard}>
            <View style={styles.stateIconWarning} accessible={false}>
              <SymbolView
                name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                size={22}
                tintColor={DesignColors.warning}
              />
            </View>
            <Text style={styles.cardTitle} accessibilityRole="header">Not available yet</Text>
            <Text style={styles.supportingText}>
              The follow-up opens 48 hours after you reached home safely.
              {dueAt ? ` Please return after ${new Date(dueAt).toLocaleString()}.` : ' Please try again later.'}
            </Text>
          </AppCard>
        ) : (
          <>
            {FOLLOWUP_QUESTIONS.map((question, index) => (
              <AppCard key={question.key} style={styles.questionCard}>
                <Text style={styles.stepLabel}>
                  Question {index + 1} of {FOLLOWUP_QUESTIONS.length}
                </Text>
                <Text style={styles.question}>{question.question}</Text>
                <View style={styles.optionList}>
                  {question.options.map((option) => {
                    const selected = answers[question.key] === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={({ pressed }) => [
                          styles.option,
                          selected && styles.optionSelected,
                          pressed && !isDisabled && styles.pressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected, disabled: isDisabled }}
                        disabled={isDisabled}
                        onPress={() => answer(question.key, option.value)}
                      >
                        <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                          {option.label}
                        </Text>
                        {selected && (
                          <SymbolView
                            name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                            size={20}
                            tintColor={isDisabled ? DesignColors.textMuted : DesignColors.primary}
                          />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </AppCard>
            ))}

            <AppCard style={styles.questionCard}>
              <Text style={styles.question}>Additional comments (optional)</Text>
              <Text style={styles.supportingText}>
                Anything else you want to share about how you are feeling.
              </Text>
              <TextInput
                style={styles.input}
                multiline
                maxLength={500}
                placeholder="Anything else you want to share (optional)."
                placeholderTextColor={DesignColors.textMuted}
                value={comments}
                editable={!isDisabled}
                onChangeText={setComments}
                accessibilityLabel="Additional comments, optional"
              />
              <Text style={styles.counter}>{comments.length}/500</Text>
            </AppCard>

            <AppButton
              label="Submit Follow-up"
              variant="primary"
              loading={isSubmitting}
              disabled={isDisabled}
              accessibilityLabel="Submit donation follow-up"
              onPress={submit}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Notice() {
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.noticeTitle}>Service Not Available</Text>
      <Text style={styles.noticeText}>{DONATION_WORKFLOW_SERVICE_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DesignColors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.lg,
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

  questionCard: { gap: Space.sm },
  stepLabel: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, letterSpacing: 0.6,
    color: DesignColors.textMuted, textTransform: 'uppercase',
  },
  question: { fontSize: TypeScale.bodyLarge, fontWeight: FontWeight.semibold, lineHeight: 24, color: DesignColors.text },
  supportingText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },

  optionList: { gap: Space.sm, marginTop: Space.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md,
    minHeight: Layout.minTouchTarget, paddingHorizontal: Space.md, paddingVertical: Space.sm,
    borderWidth: Layout.hairline, borderColor: DesignColors.border, borderRadius: Radii.md,
    backgroundColor: DesignColors.surface,
  },
  optionSelected: { borderColor: DesignColors.primary, backgroundColor: DesignColors.primarySoft },
  optionText: { flex: 1, fontSize: TypeScale.body, fontWeight: FontWeight.medium, color: DesignColors.textSecondary },
  optionTextSelected: { fontWeight: FontWeight.semibold, color: DesignColors.primaryDeep },
  pressed: { opacity: 0.72 },

  input: {
    minHeight: 112, marginTop: Space.xs, paddingHorizontal: Space.md, paddingVertical: Space.md,
    borderWidth: Layout.hairline, borderColor: DesignColors.border, borderRadius: Radii.md,
    backgroundColor: DesignColors.surface, color: DesignColors.text,
    fontSize: TypeScale.body, lineHeight: 22, textAlignVertical: 'top',
  },
  counter: { textAlign: 'right', color: DesignColors.textMuted, fontSize: TypeScale.caption, marginTop: Space.xxs },

  stateCard: { alignItems: 'flex-start', gap: Space.md },
  stateIconSuccess: {
    width: 48, height: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: DesignColors.successSurface, borderWidth: Layout.hairline, borderColor: DesignColors.successBorder,
  },
  stateIconWarning: {
    width: 48, height: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: DesignColors.warningSurface, borderWidth: Layout.hairline, borderColor: DesignColors.warningBorder,
  },
  cardTitle: { fontSize: TypeScale.subtitle, fontWeight: FontWeight.bold, lineHeight: 26, color: DesignColors.text },

  notice: {
    gap: Space.sm, padding: Space.md, borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder, backgroundColor: DesignColors.warningSurface,
  },
  noticeTitle: { fontSize: TypeScale.body, fontWeight: FontWeight.bold, color: DesignColors.warning },
  noticeText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.warning },

  errorNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, padding: Space.md,
    borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.errorBorder, backgroundColor: DesignColors.errorSurface,
  },
  errorText: { flex: 1, fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.errorText },
});

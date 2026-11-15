import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import {
  DONATION_WORKFLOW_SERVICE_ACTIVE,
  DONATION_WORKFLOW_SERVICE_MESSAGE,
  FOLLOWUP_QUESTIONS,
  FollowupAnswers,
  donorSubmitDonationFollowup,
  validateFollowupAnswers,
  verifyDonationWorkflowAccess,
} from '../lib/donation-workflow';

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
          <Text style={styles.error}>This follow-up link is invalid. Open it from your active donation.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Donation Follow-up</Text>
        <Text style={styles.description}>
          This is a general wellbeing check, not medical diagnosis or treatment advice. It becomes available 48 hours
          after you reached home safely and can be submitted once.
        </Text>

        {!DONATION_WORKFLOW_SERVICE_ACTIVE && <Notice />}
        {error !== null && <Text style={styles.error}>{error}</Text>}

        {isSubmitted ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Follow-up recorded</Text>
            <Text style={styles.detail}>Thank you. Your wellbeing responses have been submitted.</Text>
          </View>
        ) : !isDue ? (
          <View style={styles.waitingCard}>
            <Text style={styles.waitingTitle}>Not available yet</Text>
            <Text style={styles.waitingText}>
              The follow-up opens 48 hours after you reached home safely.
              {dueAt ? ` Please return after ${new Date(dueAt).toLocaleString()}.` : ' Please try again later.'}
            </Text>
          </View>
        ) : (
          <>
            {FOLLOWUP_QUESTIONS.map((question) => (
              <View key={question.key} style={styles.card}>
                <Text style={styles.question}>{question.question}</Text>
                {question.options.map((option) => {
                  const selected = answers[question.key] === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.option, selected && styles.optionSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={isSubmitting || !DONATION_WORKFLOW_SERVICE_ACTIVE}
                      onPress={() => answer(question.key, option.value)}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={styles.card}>
              <Text style={styles.question}>Additional comments (optional)</Text>
              <TextInput
                style={styles.input}
                multiline
                maxLength={500}
                placeholder="Anything else you want to share (optional)."
                value={comments}
                editable={!isSubmitting && DONATION_WORKFLOW_SERVICE_ACTIVE}
                onChangeText={setComments}
              />
              <Text style={styles.counter}>{comments.length}/500</Text>
            </View>

            <Pressable
              style={[styles.primaryButton, (isSubmitting || !DONATION_WORKFLOW_SERVICE_ACTIVE) && styles.disabled]}
              disabled={isSubmitting || !DONATION_WORKFLOW_SERVICE_ACTIVE}
              accessibilityRole="button"
              onPress={submit}
            >
              {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Submit Follow-up</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Notice() {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>Service Not Available</Text>
      <Text style={styles.noticeText}>{DONATION_WORKFLOW_SERVICE_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5F5' },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#991B1B' },
  description: { marginTop: 9, color: '#4B5563', lineHeight: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#FECACA', marginTop: 16 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#991B1B' },
  detail: { color: '#4B5563', marginTop: 9, lineHeight: 20 },
  question: { fontSize: 16, fontWeight: 'bold', color: '#991B1B', marginBottom: 8 },
  option: { borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 9, padding: 14, marginTop: 10, minHeight: 48, justifyContent: 'center' },
  optionSelected: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  optionText: { color: '#991B1B', fontWeight: '600' },
  optionTextSelected: { color: '#FFFFFF' },
  input: { borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 9, padding: 12, minHeight: 96, marginTop: 8, color: '#111827', textAlignVertical: 'top' },
  counter: { textAlign: 'right', color: '#6B7280', fontSize: 12, marginTop: 6 },
  primaryButton: { marginTop: 18, backgroundColor: '#DC2626', padding: 15, borderRadius: 10, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: 'bold' },
  disabled: { opacity: 0.55 },
  notice: { marginTop: 16, backgroundColor: '#FEF3C7', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' },
  noticeTitle: { color: '#92400E', fontWeight: 'bold', fontSize: 16 },
  noticeText: { color: '#92400E', marginTop: 7, lineHeight: 20 },
  waitingCard: { marginTop: 16, backgroundColor: '#FEF3C7', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' },
  waitingTitle: { color: '#92400E', fontWeight: 'bold', fontSize: 16 },
  waitingText: { color: '#92400E', marginTop: 7, lineHeight: 20 },
  error: { color: '#B91C1C', marginTop: 16, lineHeight: 21 },
});

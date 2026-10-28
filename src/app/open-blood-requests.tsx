import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import {
  BLOOD_REQUEST_SERVICE_ACTIVE,
  BLOOD_REQUEST_SERVICE_MESSAGE,
  OpenBloodRequest,
  donorExpressInterest,
  donorListOpenBloodRequests,
  verifyBloodRequestAccess,
} from '../lib/blood-requests';

export default function OpenBloodRequestsScreen() {
  const [requests, setRequests] = useState<OpenBloodRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interestId, setInterestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      await verifyBloodRequestAccess('donor');
      if (!BLOOD_REQUEST_SERVICE_ACTIVE) return;
      setRequests(await donorListOpenBloodRequests());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load open requests.');
    } finally { setIsLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const expressInterest = (request: OpenBloodRequest) => {
    if (interestId || !BLOOD_REQUEST_SERVICE_ACTIVE || request.has_expressed_interest) return;
    Alert.alert('Express Interest?', 'This records your willingness to help. It is not a completed donation and does not confirm medical eligibility.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Express Interest', onPress: () => void confirmInterest(request.request_id) },
    ]);
  };
  const confirmInterest = async (requestId: string) => {
    setInterestId(requestId);
    try {
      await donorExpressInterest(requestId);
      Alert.alert('Interest Recorded', 'Your willingness to help was recorded. This is not a completed donation.');
      await load();
    } catch (caught) {
      Alert.alert('Interest Not Confirmed', caught instanceof Error ? caught.message : 'Unable to record your interest.');
    } finally { setInterestId(null); }
  };

  return <SafeAreaView style={styles.container} edges={['bottom']}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>Open Blood Requests</Text>
    <Text style={styles.description}>Only open, non-expired requests matching your blood group are shown. The server confirms eligibility.</Text>
    {!BLOOD_REQUEST_SERVICE_ACTIVE ? <Notice /> : isLoading ? <Loading /> : error ? <Retry message={error} onRetry={() => void load()} /> : requests.length === 0 ? <Empty onRetry={() => void load()} /> : requests.map((request) => <View key={request.request_id} style={styles.card}>
      <View style={styles.cardHeader}><Text style={styles.bloodGroup}>{request.blood_group}</Text><Text style={[styles.urgency, request.urgency === 'urgent' && styles.urgent]}>{request.urgency === 'urgent' ? 'URGENT' : 'ROUTINE'}</Text></View>
      <Text style={styles.detail}>{request.units_requested} unit{request.units_requested === 1 ? '' : 's'} requested</Text><Text style={styles.detail}>Needed by: {request.needed_by}</Text><Text style={styles.detail}>Approximate area: {request.local_area}, {request.thana}, {request.district}</Text>
      {request.has_expressed_interest ? <Text style={styles.interested}>Interest recorded</Text> : <Pressable style={[styles.primaryButton, interestId === request.request_id && styles.disabled]} disabled={interestId !== null} onPress={() => expressInterest(request)} accessibilityRole="button"><Text style={styles.primaryText}>{interestId === request.request_id ? 'Recording Interest...' : 'Express Interest'}</Text></Pressable>}
    </View>)}
    {BLOOD_REQUEST_SERVICE_ACTIVE && <Text style={styles.disclaimer}>Expressing interest means willingness to help only. It does not complete a donation or confirm medical eligibility.</Text>}
  </ScrollView></SafeAreaView>;
}
function Notice() { return <View style={styles.notice}><Text style={styles.noticeTitle}>Service Not Available</Text><Text style={styles.noticeText}>{BLOOD_REQUEST_SERVICE_MESSAGE}</Text></View>; }
function Loading() { return <View style={styles.center}><ActivityIndicator size="large" color="#DC2626" /><Text style={styles.detail}>Loading open requests...</Text></View>; }
function Retry({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.center}><Text style={styles.error}>{message}</Text><Pressable style={styles.primaryButton} onPress={onRetry}><Text style={styles.primaryText}>Try Again</Text></Pressable></View>; }
function Empty({ onRetry }: { onRetry: () => void }) { return <View style={styles.center}><Text style={styles.emptyTitle}>No matching open requests</Text><Text style={styles.detail}>Requests may be unavailable, expired, or not match your blood group.</Text><Pressable style={styles.primaryButton} onPress={onRetry}><Text style={styles.primaryText}>Refresh</Text></Pressable></View>; }
const styles = StyleSheet.create({ container:{flex:1,backgroundColor:'#FFF5F5'},content:{padding:24,paddingBottom:48},title:{fontSize:26,fontWeight:'bold',color:'#991B1B'},description:{marginTop:9,color:'#4B5563',lineHeight:20},center:{alignItems:'center',padding:28},card:{backgroundColor:'#FFFFFF',borderRadius:12,padding:18,borderWidth:1,borderColor:'#FECACA',marginTop:16},cardHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},bloodGroup:{fontSize:28,fontWeight:'bold',color:'#DC2626'},urgency:{fontWeight:'bold',fontSize:12,color:'#15803D'},urgent:{color:'#B91C1C'},detail:{color:'#4B5563',marginTop:9,lineHeight:20},primaryButton:{marginTop:17,backgroundColor:'#DC2626',padding:13,borderRadius:9,alignItems:'center',minHeight:48,justifyContent:'center'},primaryText:{color:'#FFFFFF',fontWeight:'bold'},interested:{marginTop:17,color:'#15803D',fontWeight:'bold'},disabled:{opacity:.55},notice:{marginTop:20,backgroundColor:'#FEF3C7',padding:16,borderRadius:12,borderWidth:1,borderColor:'#FDE68A'},noticeTitle:{color:'#92400E',fontWeight:'bold',fontSize:16},noticeText:{color:'#92400E',marginTop:7,lineHeight:20},error:{color:'#B91C1C',textAlign:'center',lineHeight:21},emptyTitle:{fontSize:18,fontWeight:'bold',color:'#991B1B'},disclaimer:{marginTop:20,color:'#6B7280',fontSize:13,lineHeight:19} });

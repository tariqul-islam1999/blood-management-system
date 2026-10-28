import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import {
  BLOOD_REQUEST_SERVICE_ACTIVE,
  BLOOD_REQUEST_SERVICE_MESSAGE,
  BloodRequestError,
  MyBloodRequest,
  beneficiaryCancelBloodRequest,
  beneficiaryListMyBloodRequests,
  verifyBloodRequestAccess,
} from '../lib/blood-requests';

export default function MyBloodRequestsScreen() {
  const [requests, setRequests] = useState<MyBloodRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      await verifyBloodRequestAccess('beneficiary');
      if (!BLOOD_REQUEST_SERVICE_ACTIVE) return;
      setRequests(await beneficiaryListMyBloodRequests());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load your requests.');
    } finally { setIsLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cancel = (request: MyBloodRequest) => {
    if (cancellingId || !BLOOD_REQUEST_SERVICE_ACTIVE) return;
    Alert.alert('Cancel Blood Request?', 'This request will no longer accept donor interest.', [
      { text: 'Keep Request', style: 'cancel' },
      { text: 'Cancel Request', style: 'destructive', onPress: () => void confirmCancel(request.request_id) },
    ]);
  };
  const confirmCancel = async (requestId: string) => {
    setCancellingId(requestId);
    try {
      await beneficiaryCancelBloodRequest(requestId);
      Alert.alert('Request Cancelled', 'Your blood request was cancelled.');
      await load();
    } catch (caught) {
      Alert.alert('Cancellation Not Confirmed', caught instanceof Error ? caught.message : 'Unable to cancel this request.');
    } finally { setCancellingId(null); }
  };

  return <SafeAreaView style={styles.container} edges={['bottom']}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>My Blood Requests</Text>
    {!BLOOD_REQUEST_SERVICE_ACTIVE ? <Notice /> : isLoading ? <Loading /> : error ? <Retry message={error} onRetry={() => void load()} /> : requests.length === 0 ? <Empty onRetry={() => void load()} /> : requests.map((request) => <View key={request.request_id} style={styles.card}>
      <View style={styles.cardHeader}><Text style={styles.bloodGroup}>{request.blood_group}</Text><Text style={[styles.status, request.status === 'open' ? styles.open : styles.cancelled]}>{request.status.toUpperCase()}</Text></View>
      <Text style={styles.detail}>{request.units_requested} unit{request.units_requested === 1 ? '' : 's'} · {request.urgency === 'urgent' ? 'Urgent' : 'Routine'}</Text>
      <Text style={styles.detail}>Needed by: {request.needed_by}</Text><Text style={styles.detail}>Location: {request.local_area}, {request.thana}, {request.district}</Text>
      <Text style={styles.count}>{request.interest_count} donor interest{request.interest_count === 1 ? '' : 's'}</Text>
      {request.status === 'open' && <Pressable style={[styles.cancelButton, cancellingId === request.request_id && styles.disabled]} disabled={cancellingId !== null} onPress={() => cancel(request)} accessibilityRole="button"><Text style={styles.cancelText}>{cancellingId === request.request_id ? 'Cancelling...' : 'Cancel Request'}</Text></Pressable>}
    </View>)}
  </ScrollView></SafeAreaView>;
}
function Notice() { return <View style={styles.notice}><Text style={styles.noticeTitle}>Service Not Available</Text><Text style={styles.noticeText}>{BLOOD_REQUEST_SERVICE_MESSAGE}</Text></View>; }
function Loading() { return <View style={styles.center}><ActivityIndicator size="large" color="#DC2626" /><Text style={styles.detail}>Loading your requests...</Text></View>; }
function Retry({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.center}><Text style={styles.error}>{message}</Text><Pressable style={styles.retry} onPress={onRetry}><Text style={styles.retryText}>Try Again</Text></Pressable></View>; }
function Empty({ onRetry }: { onRetry: () => void }) { return <View style={styles.center}><Text style={styles.emptyTitle}>No blood requests yet</Text><Text style={styles.detail}>Requests you create will appear here.</Text><Pressable style={styles.retry} onPress={onRetry}><Text style={styles.retryText}>Refresh</Text></Pressable></View>; }
const styles = StyleSheet.create({ container:{flex:1,backgroundColor:'#FFF5F5'},content:{padding:24,paddingBottom:48},title:{fontSize:26,fontWeight:'bold',color:'#991B1B',marginBottom:18},center:{alignItems:'center',padding:28},card:{backgroundColor:'#FFFFFF',borderRadius:12,padding:18,borderWidth:1,borderColor:'#FECACA',marginBottom:14},cardHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},bloodGroup:{fontSize:28,fontWeight:'bold',color:'#DC2626'},status:{fontWeight:'bold',fontSize:12},open:{color:'#15803D'},cancelled:{color:'#6B7280'},detail:{color:'#4B5563',marginTop:9,lineHeight:20},count:{color:'#991B1B',fontWeight:'700',marginTop:14},cancelButton:{marginTop:16,borderWidth:1,borderColor:'#DC2626',borderRadius:9,padding:12,alignItems:'center'},cancelText:{color:'#B91C1C',fontWeight:'bold'},disabled:{opacity:.55},notice:{backgroundColor:'#FEF3C7',padding:16,borderRadius:12,borderWidth:1,borderColor:'#FDE68A'},noticeTitle:{color:'#92400E',fontWeight:'bold',fontSize:16},noticeText:{color:'#92400E',marginTop:7,lineHeight:20},error:{color:'#B91C1C',textAlign:'center',lineHeight:21},retry:{marginTop:16,backgroundColor:'#DC2626',paddingHorizontal:18,paddingVertical:12,borderRadius:9},retryText:{color:'#FFFFFF',fontWeight:'bold'},emptyTitle:{fontSize:18,fontWeight:'bold',color:'#991B1B'} });

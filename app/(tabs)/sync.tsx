import {
  ActionButton,
  Card,
  Divider,
  Header,
  MetricCard,
  Pill,
  RowItem,
  Screen,
  SectionTitle,
  StatRow,
} from "@/components/app-ui";
import { logout } from "@/services/features/auth/authSlice";
import { resetOfflineState } from "@/services/features/offline/offlineSlice";
import {
  clearOfflineDatabase,
  getOfflineDbSize,
  resetDatabaseCompletely,
} from "@/services/offline/db";
import {
  getFailedItemsWithDetails,
  getSyncQueueSummary,
  retryOutboxItem,
} from "@/services/offline/repository";
import { useSync } from "@/services/offline/syncManager";
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { clearAllOutboxItems } from "@/services/offline/repository";
import { useDispatch } from "react-redux";
import { useRouter } from "expo-router";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { getLocalActiveSession } from "@/services/offline/repository";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SyncScreen() {
  const dispatch = useDispatch();
  const router = useRouter();
  const { user, currentStoreId } = useAppSelector((state) => state.auth);

  const {
    isOnline,
    isSyncing,
    isLoading,
    syncStatus,
    syncPhase,
    syncError,
    queueCount,
    failedCount,
    syncProgress,
    lastSyncAt,
    sync,
    retry,
    refresh,
  } = useSync();

  const [showFailedItems, setShowFailedItems] = useState(false);
  const [failedItems, setFailedItems] = useState<any[]>([]);
  const [queueSummary, setQueueSummary] = useState<any>(null);
  const [dbSize, setDbSize] = useState<string>("0 KB");
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);

  // Load details (queue summary, failed items, db size)
  const loadDetails = async () => {
    setIsLoadingDetails(true);
    try {
      const summary = await getSyncQueueSummary();
      setQueueSummary(summary);

      const failed = await getFailedItemsWithDetails(20);
      setFailedItems(failed);
    } catch (error) {
      console.error("Failed to load sync details:", error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const loadDbSize = async () => {
    try {
      const size = await getOfflineDbSize();
      setDbSize(size);
    } catch (error) {
      console.error("Failed to get DB size:", error);
    }
  };

  // Combined refresh: reloads all stats
  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), loadDetails(), loadDbSize()]);
  }, [refresh]);

  // Auto-refresh on screen focus
  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );

  // Auto-refresh after sync completes or errors
  useEffect(() => {
    if (syncStatus === "complete" || syncStatus === "error") {
      refreshAll();
    }
  }, [syncStatus, refreshAll]);

  // Auto-refresh when online status changes (in case network comes back)
  useEffect(() => {
    if (isOnline) {
      refreshAll();
    }
  }, [isOnline, refreshAll]);

  const handleSyncNow = () => {
    sync({ force: true });
    // refresh will be triggered by syncStatus change
  };

  const handleRetry = () => {
    retry();
    // refresh after retry will be triggered by syncStatus change
  };

  const handleRetrySingleItem = async (itemId: string) => {
    setRetryingItemId(itemId);
    try {
      await retryOutboxItem(itemId);
      await refreshAll();
      Alert.alert("Success", "Item has been queued for retry.");
    } catch (error) {
      Alert.alert("Error", "Failed to retry item.");
    } finally {
      setRetryingItemId(null);
    }
  };

  const handleClearOutbox = async () => {
    const count = await clearAllOutboxItems();
    Alert.alert("Cleared", `${count} items removed from outbox`);
    await refreshAll();
  };

  const handleClearDatabase = () => {
    Alert.alert(
      "Clear Offline Database",
      "This will remove all offline data including products, orders, and pending sync items. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All Data",
          style: "destructive",
          onPress: async () => {
            try {
              await clearOfflineDatabase();
              Alert.alert("Success", "Offline database cleared.");
              await refreshAll();
              router.replace("/login");
            } catch (error) {
              Alert.alert("Error", "Failed to clear database.");
            }
          },
        },
      ],
    );
  };

  const handleSignOut = async () => {
    // Check for open session first
    if (user?.id) {
      const activeSession = await getLocalActiveSession(
        user.id,
        currentStoreId || undefined,
      );
      if (activeSession) {
        Alert.alert(
          "Open Session Detected",
          "You must close your current cash register session before signing out.",
          [{ text: "OK", style: "default" }],
        );
        return;
      }
    }

    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out? Offline data will be cleared.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            try {
              await clearOfflineDatabase();
              await resetDatabaseCompletely();
              dispatch(resetOfflineState());
              dispatch(logout());
            } catch (error) {
              Alert.alert("Sign Out Failed", "Could not clear data.");
            }
          },
        },
      ],
    );
  };

  const renderFailedItem = ({ item }: { item: any }) => (
    <View className="bg-white/5 rounded-xl p-3 mb-2 border border-white/10">
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="text-white font-semibold">
            {item.entity} - {item.operation}
          </Text>
          <Text className="text-slate-400 text-xs mt-1">
            ID: {item.entityId}
          </Text>
          {item.lastError && (
            <Text className="text-rose-400 text-xs mt-1" numberOfLines={2}>
              Error: {item.lastError}
            </Text>
          )}
          <Text className="text-slate-500 text-[10px] mt-1">
            Attempts: {item.attempts} •{" "}
            {new Date(item.createdAt).toLocaleString()}
          </Text>
        </View>
        <TouchableOpacity
          className="bg-sky-500/20 p-2 rounded-full"
          onPress={() => handleRetrySingleItem(item.id)}
          disabled={retryingItemId === item.id}
        >
          {retryingItemId === item.id ? (
            <ActivityIndicator size="small" color="#38bdf8" />
          ) : (
            <MaterialIcons name="refresh" size={18} color="#38bdf8" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Screen padded={false}>
      <SafeAreaView className="flex-1">
        <View className="">
          <Header
            eyebrow="System Status"
            title="Synchronization"
            subtitle="Manage offline data and connectivity"
            right={
              <View className="mt-2 items-end gap-2">
                <Pill
                  label={isOnline ? "ONLINE" : "OFFLINE"}
                  tone={isOnline ? "emerald" : "rose"}
                />
                <Pill label="INCREMENTAL" tone="sky" />
              </View>
            }
          />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1 p-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Status Section */}
        <SectionTitle title="Overview" />

        <View className="flex gap-3 mb-3 mt-0">
          <View className="flex flex-row gap-3">
            <MetricCard
              icon="cloud-upload"
              label="Pending"
              value={queueCount?.toString() ?? "0"}
              tone={queueCount > 0 ? "sky" : "emerald"}
            />
            <MetricCard
              icon="error-outline"
              label="Failed"
              value={failedCount?.toString() ?? "0"}
              tone={failedCount > 0 ? "rose" : "emerald"}
            />
          </View>
          <View className="flex flex-row gap-3">
            <MetricCard
              icon="storage"
              label="Database"
              value={dbSize}
              tone="amber"
            />
            <ActionButton
              title={isSyncing ? "Syncing..." : "Sync Now"}
              icon="sync"
              accent={isOnline && !isSyncing ? "sky" : "amber"}
              onPress={isOnline && !isSyncing ? handleSyncNow : undefined}
              disabled={isSyncing || !isOnline}
            />
          </View>
        </View>

        {/* Sync Progress */}
        {(isSyncing || syncStatus === "complete" || syncStatus === "error") && (
          <Card className="mb-5">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-slate-300 font-semibold text-xs uppercase tracking-widest">
                Syncing Progress
              </Text>
              <Text className="text-sky-400 font-bold text-xs">
                {Math.round(syncProgress)}%
              </Text>
            </View>
            <View className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
              <View
                className="h-full bg-sky-500 rounded-full"
                style={{ width: `${syncProgress}%` }}
              />
            </View>
            <Text className="text-slate-400 text-xs mt-2 text-center">
              {syncPhase}
            </Text>
          </Card>
        )}

        {/* Details Section */}
        <SectionTitle
          title="Sync Details"
          action="Refresh"
          onAction={refreshAll}
        />

        <Card className="mb-6">
          <StatRow
            label="Last Synced"
            value={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "Never"}
          />
          <Divider />
          <StatRow
            label="Network Status"
            value={isOnline ? "Connected" : "Disconnected"}
            valueColor={isOnline ? "#34d399" : "#f87171"}
          />
          <Divider />
          <StatRow
            label="Sync Status"
            value={
              isSyncing
                ? "In Progress..."
                : syncStatus === "error"
                  ? "Failed"
                  : syncStatus === "complete"
                    ? "Completed"
                    : "Ready"
            }
          />
          <Divider />
          <StatRow label="Sync Activity" value={syncPhase} />
          <Divider />
          <StatRow
            label="Total Pending"
            value={queueSummary?.pending?.toString() || "0"}
          />
          <Divider />
          <StatRow
            label="Total Failed"
            value={queueSummary?.failed?.toString() || "0"}
            valueColor={queueSummary?.failed > 0 ? "#f87171" : "#34d399"}
          />
          <Divider />
          <StatRow
            label="Total Dead"
            value={queueSummary?.dead?.toString() || "0"}
            valueColor={queueSummary?.dead > 0 ? "#fbbf24" : "#94a3b8"}
          />

          {/* Entity Breakdown */}
          {queueSummary?.byEntity && (
            <View className="mt-3 pt-3 border-t border-white/10">
              <Text className="text-slate-400 text-xs uppercase tracking-widest font-semibold mb-2">
                Entity Breakdown
              </Text>
              {Object.entries(queueSummary.byEntity).map(
                ([entity, data]: [string, any]) => (
                  <View key={entity} className="flex-row justify-between py-1">
                    <Text className="text-slate-300 text-sm capitalize">
                      {entity.replace("_", " ")}
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      {data.pending > 0 && (
                        <Text className="text-sky-400"> {data.pending}p</Text>
                      )}
                      {data.failed > 0 && (
                        <Text className="text-rose-400"> {data.failed}f</Text>
                      )}
                      {data.synced > 0 && (
                        <Text className="text-emerald-400">
                          {" "}
                          {data.synced}s
                        </Text>
                      )}
                      <Text className="text-slate-500"> ({data.total})</Text>
                    </Text>
                  </View>
                ),
              )}
            </View>
          )}
        </Card>

        {/* Error Display */}
        {syncError && (
          <Card className="mb-5 border border-rose-500/30 bg-rose-500/10">
            <View className="flex-row items-start">
              <MaterialIcons name="error-outline" size={20} color="#f87171" />
              <View className="flex-1 ml-2">
                <Text className="text-rose-400 text-sm font-medium">
                  {syncError}
                </Text>
                <TouchableOpacity onPress={handleRetry} className="mt-2">
                  <Text className="text-sky-400 text-xs font-semibold">
                    Retry Now →
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        )}

        {/* Failed Items Section */}
        {failedCount > 0 && (
          <>
            <SectionTitle
              title="Failed Items"
              action={
                failedItems.length > 0
                  ? `${failedItems.length} items`
                  : undefined
              }
            />
            <TouchableOpacity
              className="bg-rose-500/10 rounded-xl p-4 mb-4 border border-rose-500/20"
              onPress={() => setShowFailedItems(true)}
            >
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center">
                  <MaterialIcons name="error" size={24} color="#f87171" />
                  <Text className="text-white ml-3 font-semibold">
                    {failedCount} items failed to sync
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
              </View>
              <Text className="text-slate-400 text-xs mt-1">
                Tap to view and retry individual items
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* Actions Section */}
        <SectionTitle title="Actions" />

        <View className="flex-row flex-wrap gap-3 mt-2 mb-3">
          <ActionButton
            title={isSyncing ? "Syncing..." : "Sync Now"}
            icon="sync"
            accent={isOnline && !isSyncing ? "sky" : "amber"}
            onPress={isOnline && !isSyncing ? handleSyncNow : undefined}
            disabled={isSyncing || !isOnline}
          />

          <ActionButton
            title="Clear Outbox"
            icon="delete-sweep"
            accent="rose"
            onPress={handleClearOutbox}
          />

          {failedCount > 0 && (
            <ActionButton
              title="Retry All"
              icon="refresh"
              accent="rose"
              onPress={isOnline && !isSyncing ? handleRetry : undefined}
              disabled={isSyncing || !isOnline}
            />
          )}
        </View>

        {/* Sync Progress */}
        {(isSyncing || syncStatus === "complete" || syncStatus === "error") && (
          <Card className="mb-5">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-slate-300 font-semibold text-xs uppercase tracking-widest">
                Syncing Progress
              </Text>
              <Text className="text-sky-400 font-bold text-xs">
                {Math.round(syncProgress)}%
              </Text>
            </View>
            <View className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
              <View
                className="h-full bg-sky-500 rounded-full"
                style={{ width: `${syncProgress}%` }}
              />
            </View>
            <Text className="text-slate-400 text-xs mt-2 text-center">
              {syncPhase}
            </Text>
          </Card>
        )}

        <View className="mt-2">
          <RowItem
            title="Refresh Statistics"
            subtitle="Manually update queue counts"
            icon="update"
            onPress={refreshAll}
          />
          <RowItem
            title="Clear Offline Database"
            subtitle={`Current size: ${dbSize}`}
            icon="delete-sweep"
            accent="rose"
            onPress={handleClearDatabase}
          />
          <RowItem
            title="Sign Out"
            subtitle="Clear data and return to login"
            icon="logout"
            accent="rose"
            onPress={handleSignOut}
          />
        </View>

        {/* Version Info */}
        <View className="mt-6 items-center">
          <Text className="text-slate-600 text-xs">
            Offline Mode v2.0 • Data stored locally
          </Text>
          <Text className="text-slate-600 text-xs">
            ERP/POS • Dev Htoo Myat Nyi Nyi (MM)
          </Text>
          {isLoadingDetails && (
            <ActivityIndicator size="small" color="#38bdf8" className="mt-2" />
          )}
        </View>
      </ScrollView>

      {/* Failed Items Modal */}
      <Modal
        visible={showFailedItems}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFailedItems(false)}
      >
        <View className="flex-1 bg-black/80">
          <View className="flex-1 bg-slate-900 rounded-t-3xl mt-12">
            <View className=" pt-5 pb-4">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-white font-bold text-xl">
                  Failed Items ({failedItems.length})
                </Text>
                <TouchableOpacity onPress={() => setShowFailedItems(false)}>
                  <MaterialIcons name="close" size={24} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {isLoadingDetails ? (
                <View className="flex-1 items-center justify-center">
                  <ActivityIndicator size="large" color="#38bdf8" />
                </View>
              ) : (
                <FlatList
                  data={failedItems}
                  keyExtractor={(item) => item.id}
                  renderItem={renderFailedItem}
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={
                    <View className="items-center justify-center py-8">
                      <MaterialIcons
                        name="check-circle"
                        size={48}
                        color="#34d399"
                      />
                      <Text className="text-white mt-3 font-semibold">
                        No failed items
                      </Text>
                    </View>
                  }
                />
              )}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
// // working one.
// import {
//   ActionButton,
//   Card,
//   Divider,
//   Header,
//   MetricCard,
//   Pill,
//   RowItem,
//   Screen,
//   SectionTitle,
//   StatRow,
// } from "@/components/app-ui";
// import { logout } from "@/services/features/auth/authSlice";
// import { resetOfflineState } from "@/services/features/offline/offlineSlice";
// import {
//   clearOfflineDatabase,
//   getOfflineDbSize,
//   resetDatabaseCompletely,
// } from "@/services/offline/db";
// import {
//   getFailedItemsWithDetails,
//   getSyncQueueSummary,
//   retryOutboxItem,
// } from "@/services/offline/repository";
// import { useSync } from "@/services/offline/syncManager";
// import { MaterialIcons } from "@expo/vector-icons";
// import React, { useEffect, useState } from "react";
// import {
//   ActivityIndicator,
//   Alert,
//   FlatList,
//   Modal,
//   ScrollView,
//   Text,
//   TouchableOpacity,
//   View,
// } from "react-native";
// import { clearAllOutboxItems } from "@/services/offline/repository";
// import { useDispatch } from "react-redux";
// import { useRouter } from "expo-router";
// import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
// import { getLocalActiveSession } from "@/services/offline/repository";

// export default function SyncScreen() {
//   const dispatch = useDispatch();
//   const router = useRouter();
//   const { user, currentStoreId } = useAppSelector((state) => state.auth);

//   const {
//     isOnline,
//     isSyncing,
//     isLoading,
//     syncStatus,
//     syncPhase,
//     syncError,
//     queueCount,
//     failedCount,
//     syncProgress,
//     lastSyncAt,
//     sync,
//     retry,
//     refresh,
//   } = useSync();

//   const [showFailedItems, setShowFailedItems] = useState(false);
//   const [failedItems, setFailedItems] = useState<any[]>([]);
//   const [queueSummary, setQueueSummary] = useState<any>(null);
//   const [dbSize, setDbSize] = useState<string>("0 KB");
//   const [isLoadingDetails, setIsLoadingDetails] = useState(false);
//   const [retryingItemId, setRetryingItemId] = useState<string | null>(null);

//   // Load details on mount
//   useEffect(() => {
//     loadDetails();
//     loadDbSize();
//   }, []);

//   const loadDetails = async () => {
//     setIsLoadingDetails(true);
//     try {
//       const summary = await getSyncQueueSummary();
//       setQueueSummary(summary);

//       const failed = await getFailedItemsWithDetails(20);
//       setFailedItems(failed);
//     } catch (error) {
//       console.error("Failed to load sync details:", error);
//     } finally {
//       setIsLoadingDetails(false);
//     }
//   };

//   const loadDbSize = async () => {
//     try {
//       const size = await getOfflineDbSize();
//       setDbSize(size);
//     } catch (error) {
//       console.error("Failed to get DB size:", error);
//     }
//   };

//   const handleSyncNow = () => {
//     sync({ force: true });
//   };

//   const handleRetry = () => {
//     retry();
//   };

//   const handleRetrySingleItem = async (itemId: string) => {
//     setRetryingItemId(itemId);
//     try {
//       await retryOutboxItem(itemId);
//       await loadDetails();
//       Alert.alert("Success", "Item has been queued for retry.");
//     } catch (error) {
//       Alert.alert("Error", "Failed to retry item.");
//     } finally {
//       setRetryingItemId(null);
//     }
//   };

//   const handleClearDatabase = () => {
//     Alert.alert(
//       "Clear Offline Database",
//       "This will remove all offline data including products, orders, and pending sync items. This action cannot be undone.",
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Clear All Data",
//           style: "destructive",
//           onPress: async () => {
//             try {
//               await clearOfflineDatabase();
//               Alert.alert("Success", "Offline database cleared.");
//               loadDetails();
//               loadDbSize();
//               router.replace("/login");
//             } catch (error) {
//               Alert.alert("Error", "Failed to clear database.");
//             }
//           },
//         },
//       ],
//     );
//   };

//   const handleSignOut = async () => {
//     // Check for open session first
//     if (user?.id) {
//       const activeSession = await getLocalActiveSession(
//         user.id,
//         currentStoreId || undefined,
//       );
//       if (activeSession) {
//         Alert.alert(
//           "Open Session Detected",
//           "You must close your current cash register session before signing out.",
//           [{ text: "OK", style: "default" }],
//         );
//         return;
//       }
//     }

//     Alert.alert(
//       "Sign Out",
//       "Are you sure you want to sign out? Offline data will be cleared.",
//       [
//         { text: "Cancel", style: "cancel" },
//         {
//           text: "Sign Out",
//           style: "destructive",
//           onPress: async () => {
//             try {
//               await clearOfflineDatabase();
//               // Reset the database connection completely
//               await resetDatabaseCompletely();
//               // Reset Redux state
//               dispatch(resetOfflineState());
//               // Logout (clears auth and navigates to login)
//               dispatch(logout());
//             } catch (error) {
//               Alert.alert("Sign Out Failed", "Could not clear data.");
//             }
//           },
//         },
//       ],
//     );
//   };

//   const renderFailedItem = ({ item }: { item: any }) => (
//     <View className="bg-white/5 rounded-xl p-3 mb-2 border border-white/10">
//       <View className="flex-row justify-between items-start">
//         <View className="flex-1">
//           <Text className="text-white font-semibold">
//             {item.entity} - {item.operation}
//           </Text>
//           <Text className="text-slate-400 text-xs mt-1">
//             ID: {item.entityId}
//           </Text>
//           {item.lastError && (
//             <Text className="text-rose-400 text-xs mt-1" numberOfLines={2}>
//               Error: {item.lastError}
//             </Text>
//           )}
//           <Text className="text-slate-500 text-[10px] mt-1">
//             Attempts: {item.attempts} •{" "}
//             {new Date(item.createdAt).toLocaleString()}
//           </Text>
//         </View>
//         <TouchableOpacity
//           className="bg-sky-500/20 p-2 rounded-full"
//           onPress={() => handleRetrySingleItem(item.id)}
//           disabled={retryingItemId === item.id}
//         >
//           {retryingItemId === item.id ? (
//             <ActivityIndicator size="small" color="#38bdf8" />
//           ) : (
//             <MaterialIcons name="refresh" size={18} color="#38bdf8" />
//           )}
//         </TouchableOpacity>
//       </View>
//     </View>
//   );

//   return (
//     <Screen padded={false}>
//       <View className=" pt-6 pb-4">
//         <Header
//           eyebrow="System Status"
//           title="Synchronization"
//           subtitle="Manage offline data and connectivity"
//           right={
//             <View className="mt-2">
//               <Pill
//                 label={isOnline ? "ONLINE" : "OFFLINE"}
//                 tone={isOnline ? "emerald" : "rose"}
//               />
//             </View>
//           }
//         />
//       </View>

//       <ScrollView
//         className="flex-1 "
//         contentContainerStyle={{ paddingBottom: 40 }}
//         showsVerticalScrollIndicator={false}
//       >
//         {/* Status Section */}
//         {/* <SectionTitle title="Overview" /> */}

//         {/* <View className="flex gap-3 mb-3 mt-0">
//           <View className="flex flex-row gap-3">
//             <MetricCard
//               icon="cloud-upload"
//               label="Pending"
//               value={queueCount?.toString() ?? "0"}
//               tone={queueCount > 0 ? "sky" : "emerald"}
//             />
//             <MetricCard
//               icon="error-outline"
//               label="Failed"
//               value={failedCount?.toString() ?? "0"}
//               tone={failedCount > 0 ? "rose" : "emerald"}
//             />
//           </View>
//           <View className="flex flex-row gap-3">
//             <MetricCard
//               icon="storage"
//               label="Database"
//               value={dbSize}
//               tone="amber"
//             />
//             <ActionButton
//               title={isSyncing ? "Syncing..." : "Sync Now"}
//               icon="sync"
//               accent={isOnline && !isSyncing ? "sky" : "amber"}
//               onPress={isOnline && !isSyncing ? handleSyncNow : undefined}
//               disabled={isSyncing || !isOnline}
//             />
//           </View>
//         </View> */}

//         {/* <ActionButton
//           title={isSyncing ? "Syncing..." : "Sync Now"}
//           icon="sync"
//           accent={isOnline && !isSyncing ? "sky" : "amber"}
//           onPress={isOnline && !isSyncing ? handleSyncNow : undefined}
//           disabled={isSyncing || !isOnline}
//         /> */}

//         {/* Sync Progress */}
//         {/* {(isSyncing || syncStatus === "complete" || syncStatus === "error") && (
//           <Card className="mb-5">
//             <View className="flex-row items-center justify-between mb-2">
//               <Text className="text-slate-300 font-semibold text-xs uppercase tracking-widest">
//                 Syncing Progress
//               </Text>
//               <Text className="text-sky-400 font-bold text-xs">
//                 {Math.round(syncProgress)}%
//               </Text>
//             </View>
//             <View className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
//               <View
//                 className="h-full bg-sky-500 rounded-full"
//                 style={{ width: `${syncProgress}%` }}
//               />
//             </View>
//             <Text className="text-slate-400 text-xs mt-2 text-center">
//               {syncPhase}
//             </Text>
//           </Card>
//         )} */}

//         {/* Error Display */}
//         {syncError && (
//           <Card className="mb-5 border border-rose-500/30 bg-rose-500/10">
//             <View className="flex-row items-start">
//               <MaterialIcons name="error-outline" size={20} color="#f87171" />
//               <View className="flex-1 ml-2">
//                 <Text className="text-rose-400 text-sm font-medium">
//                   {syncError}
//                 </Text>
//                 <TouchableOpacity onPress={handleRetry} className="mt-2">
//                   <Text className="text-sky-400 text-xs font-semibold">
//                     Retry Now →
//                   </Text>
//                 </TouchableOpacity>
//               </View>
//             </View>
//           </Card>
//         )}

//         {/* Details Section */}
//         <SectionTitle
//           title="Sync Details"
//           action="Refresh"
//           onAction={refresh}
//         />

//         <Card className="mb-6">
//           <StatRow
//             label="Last Synced"
//             value={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "Never"}
//           />
//           <Divider />
//           <StatRow
//             label="Network Status"
//             value={isOnline ? "Connected" : "Disconnected"}
//             valueColor={isOnline ? "#34d399" : "#f87171"}
//           />
//           <Divider />
//           <StatRow
//             label="Sync Status"
//             value={
//               isSyncing
//                 ? "In Progress..."
//                 : syncStatus === "error"
//                   ? "Failed"
//                   : syncStatus === "complete"
//                     ? "Completed"
//                     : "Ready"
//             }
//           />
//           <Divider />
//           <StatRow label="Sync Activity" value={syncPhase} />
//           <Divider />
//           <StatRow
//             label="Total Pending"
//             value={queueSummary?.pending?.toString() || "0"}
//           />
//           <Divider />
//           <StatRow
//             label="Total Failed"
//             value={queueSummary?.failed?.toString() || "0"}
//             valueColor={queueSummary?.failed > 0 ? "#f87171" : "#34d399"}
//           />
//           <Divider />
//           <StatRow
//             label="Total Dead"
//             value={queueSummary?.dead?.toString() || "0"}
//             valueColor={queueSummary?.dead > 0 ? "#fbbf24" : "#94a3b8"}
//           />

//           {/* Entity Breakdown */}
//           {queueSummary?.byEntity && (
//             <View className="mt-3 pt-3 border-t border-white/10">
//               <Text className="text-slate-400 text-xs uppercase tracking-widest font-semibold mb-2">
//                 Entity Breakdown
//               </Text>
//               {Object.entries(queueSummary.byEntity).map(
//                 ([entity, data]: [string, any]) => (
//                   <View key={entity} className="flex-row justify-between py-1">
//                     <Text className="text-slate-300 text-sm capitalize">
//                       {entity.replace("_", " ")}
//                     </Text>
//                     <Text className="text-slate-400 text-sm">
//                       {data.pending > 0 && (
//                         <Text className="text-sky-400"> {data.pending}p</Text>
//                       )}
//                       {data.failed > 0 && (
//                         <Text className="text-rose-400"> {data.failed}f</Text>
//                       )}
//                       {data.synced > 0 && (
//                         <Text className="text-emerald-400">
//                           {" "}
//                           {data.synced}s
//                         </Text>
//                       )}
//                       <Text className="text-slate-500"> ({data.total})</Text>
//                     </Text>
//                   </View>
//                 ),
//               )}
//             </View>
//           )}
//         </Card>

//         {/* Sync Progress */}
//         {(isSyncing || syncStatus === "complete" || syncStatus === "error") && (
//           <Card className="mb-5">
//             <View className="flex-row items-center justify-between mb-2">
//               <Text className="text-slate-300 font-semibold text-xs uppercase tracking-widest">
//                 Syncing Progress
//               </Text>
//               <Text className="text-sky-400 font-bold text-xs">
//                 {Math.round(syncProgress)}%
//               </Text>
//             </View>
//             <View className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
//               <View
//                 className="h-full bg-sky-500 rounded-full"
//                 style={{ width: `${syncProgress}%` }}
//               />
//             </View>
//             <Text className="text-slate-400 text-xs mt-2 text-center">
//               {syncPhase}
//             </Text>
//           </Card>
//         )}

//         {/* Failed Items Section */}
//         {failedCount > 0 && (
//           <>
//             <SectionTitle
//               title="Failed Items"
//               action={
//                 failedItems.length > 0
//                   ? `${failedItems.length} items`
//                   : undefined
//               }
//             />
//             <TouchableOpacity
//               className="bg-rose-500/10 rounded-xl p-4 mb-4 border border-rose-500/20"
//               onPress={() => setShowFailedItems(true)}
//             >
//               <View className="flex-row justify-between items-center">
//                 <View className="flex-row items-center">
//                   <MaterialIcons name="error" size={24} color="#f87171" />
//                   <Text className="text-white ml-3 font-semibold">
//                     {failedCount} items failed to sync
//                   </Text>
//                 </View>
//                 <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
//               </View>
//               <Text className="text-slate-400 text-xs mt-1">
//                 Tap to view and retry individual items
//               </Text>
//             </TouchableOpacity>
//           </>
//         )}

//         {/* Actions Section */}
//         <SectionTitle title="Actions" />

//         <View className="flex-row gap-3 mt-2 mb-3">
//           <ActionButton
//             title={isSyncing ? "Syncing..." : "Sync Now"}
//             icon="sync"
//             accent={isOnline && !isSyncing ? "sky" : "amber"}
//             onPress={isOnline && !isSyncing ? handleSyncNow : undefined}
//             disabled={isSyncing || !isOnline}
//           />

//           <ActionButton
//             title="Clear All Outbox"
//             icon="delete-sweep"
//             accent="rose"
//             onPress={async () => {
//               const count = await clearAllOutboxItems();
//               Alert.alert("Cleared", `${count} items removed from outbox`);
//               refresh();
//             }}
//           />

//           {failedCount > 0 && (
//             <ActionButton
//               title="Retry All"
//               icon="refresh"
//               accent="rose"
//               onPress={isOnline && !isSyncing ? handleRetry : undefined}
//               disabled={isSyncing || !isOnline}
//             />
//           )}
//         </View>

//         <View className="mt-2">
//           <RowItem
//             title="Refresh Statistics"
//             subtitle="Manually update queue counts"
//             icon="update"
//             onPress={() => {
//               refresh();
//               loadDetails();
//               loadDbSize();
//             }}
//           />
//           <RowItem
//             title="Clear Offline Database"
//             subtitle={`Current size: ${dbSize}`}
//             icon="delete-sweep"
//             accent="rose"
//             onPress={handleClearDatabase}
//           />
//           <RowItem
//             title="Sign Out"
//             subtitle="Clear data and return to login"
//             icon="logout"
//             accent="rose"
//             onPress={handleSignOut}
//           />
//         </View>

//         {/* Version Info */}
//         <View className="mt-6 items-center">
//           <Text className="text-slate-600 text-xs">
//             Offline Mode v2.0 • Data stored locally
//           </Text>
//           {isLoadingDetails && (
//             <ActivityIndicator size="small" color="#38bdf8" className="mt-2" />
//           )}
//         </View>
//       </ScrollView>

//       {/* Failed Items Modal */}
//       <Modal
//         visible={showFailedItems}
//         transparent
//         animationType="slide"
//         onRequestClose={() => setShowFailedItems(false)}
//       >
//         <View className="flex-1 bg-black/80">
//           <View className="flex-1 bg-slate-900 rounded-t-3xl mt-12">
//             <View className=" pt-5 pb-4">
//               <View className="flex-row justify-between items-center mb-4">
//                 <Text className="text-white font-bold text-xl">
//                   Failed Items ({failedItems.length})
//                 </Text>
//                 <TouchableOpacity onPress={() => setShowFailedItems(false)}>
//                   <MaterialIcons name="close" size={24} color="#94a3b8" />
//                 </TouchableOpacity>
//               </View>

//               {isLoadingDetails ? (
//                 <View className="flex-1 items-center justify-center">
//                   <ActivityIndicator size="large" color="#38bdf8" />
//                 </View>
//               ) : (
//                 <FlatList
//                   data={failedItems}
//                   keyExtractor={(item) => item.id}
//                   renderItem={renderFailedItem}
//                   showsVerticalScrollIndicator={false}
//                   ListEmptyComponent={
//                     <View className="items-center justify-center py-8">
//                       <MaterialIcons
//                         name="check-circle"
//                         size={48}
//                         color="#34d399"
//                       />
//                       <Text className="text-white mt-3 font-semibold">
//                         No failed items
//                       </Text>
//                     </View>
//                   }
//                 />
//               )}
//             </View>
//           </View>
//         </View>
//       </Modal>
//     </Screen>
//   );
// }

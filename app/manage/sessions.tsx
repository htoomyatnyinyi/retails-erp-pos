import {
  Card,
  Header,
  Pill,
  Screen,
  SectionTitle,
} from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import {
  useGetLocalSessionsQuery,
  useGetLocalStaffQuery,
  useGetLocalStoresQuery,
} from "@/services/features/offline/localApi";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type FilterStatus = "ALL" | "OPEN" | "CLOSED";

export default function SessionLogsScreen() {
  const { currentStoreId } = useAppSelector((state) => state.auth);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    data: sessions = [],
    isLoading,
    refetch: refetchSessions,
  } = useGetLocalSessionsQuery({ storeId: currentStoreId || undefined });

  const { data: staffList = [] } = useGetLocalStaffQuery({
    storeId: currentStoreId || undefined,
  });

  const { data: storeList = [] } = useGetLocalStoresQuery({});

  const getStaffName = (userId: string) => {
    const found = staffList.find(
      (s: any) => s.id === userId || s.remoteId === userId,
    );
    return found?.name || userId?.slice(0, 8) || "Unknown";
  };

  const getStoreName = (storeId: string | null) => {
    if (!storeId) return "—";
    const found = storeList.find(
      (s: any) => s.id === storeId || s.remoteId === storeId,
    );
    return found?.name || storeId?.slice(0, 8) || "—";
  };

  const filteredSessions = useMemo(() => {
    let list = [...sessions].sort(
      (a: any, b: any) =>
        new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
    );
    if (filterStatus !== "ALL") {
      list = list.filter(
        (s: any) => s.status?.toUpperCase() === filterStatus,
      );
    }
    return list;
  }, [sessions, filterStatus]);

  // Summary stats
  const stats = useMemo(() => {
    const closed = sessions.filter(
      (s: any) => s.status?.toUpperCase() === "CLOSED",
    );
    const totalDiscrepancy = closed.reduce(
      (sum: number, s: any) => sum + Math.abs(Number(s.discrepancy || 0)),
      0,
    );
    const sessionsWithDiscrepancy = closed.filter(
      (s: any) => Math.abs(Number(s.discrepancy || 0)) > 0.01,
    );
    const openCount = sessions.filter(
      (s: any) => s.status?.toUpperCase() === "OPEN",
    ).length;
    return {
      totalSessions: sessions.length,
      openCount,
      closedCount: closed.length,
      totalDiscrepancy,
      discrepancyCount: sessionsWithDiscrepancy.length,
    };
  }, [sessions]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchSessions();
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (val: number | null | undefined) => {
    return `$${Number(val || 0).toFixed(2)}`;
  };

  return (
    <Screen padded={false}>
      <SafeAreaView className="flex-1 bg-slate-950">
        {/* Header */}
        <View className="px-5 pt-6 pb-2">
          <View className="flex-row items-center mb-3">
            <TouchableOpacity
              onPress={() => router.back()}
              className="mr-3 w-9 h-9 rounded-full bg-slate-800 items-center justify-center"
            >
              <MaterialIcons name="arrow-back" size={20} color="#94a3b8" />
            </TouchableOpacity>
            <Header
              eyebrow="Admin Control"
              title="Session Logs"
              subtitle="Register open/close history & discrepancies"
            />
          </View>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text className="text-slate-400 mt-4 font-medium">
              Loading sessions...
            </Text>
          </View>
        ) : (
          <ScrollView
            className="px-5"
            contentContainerStyle={{ paddingBottom: 60 }}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor="#38bdf8"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {/* Summary Cards */}
            <View className="flex-row flex-wrap gap-3 mb-5">
              <View className="w-[48%]">
                <Card>
                  <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                    Total Sessions
                  </Text>
                  <Text className="text-white text-2xl font-black mt-1">
                    {stats.totalSessions}
                  </Text>
                  <Text className="text-sky-400 text-[10px] mt-1 font-semibold">
                    {stats.openCount} open · {stats.closedCount} closed
                  </Text>
                </Card>
              </View>
              <View className="w-[48%]">
                <Card>
                  <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                    Total Discrepancy
                  </Text>
                  <Text
                    className={`text-2xl font-black mt-1 ${stats.totalDiscrepancy > 0 ? "text-rose-400" : "text-emerald-400"}`}
                  >
                    {formatCurrency(stats.totalDiscrepancy)}
                  </Text>
                  <Text className="text-amber-400 text-[10px] mt-1 font-semibold">
                    {stats.discrepancyCount} session(s) with variance
                  </Text>
                </Card>
              </View>
            </View>

            {/* Filter Pills */}
            <View className="flex-row gap-2 mb-4">
              {(["ALL", "OPEN", "CLOSED"] as FilterStatus[]).map((status) => {
                const active = filterStatus === status;
                return (
                  <TouchableOpacity
                    key={status}
                    onPress={() => setFilterStatus(status)}
                    className={`rounded-full border px-4 py-2 ${
                      active
                        ? "border-sky-400/40 bg-sky-500/20"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold uppercase tracking-wider ${
                        active ? "text-sky-200" : "text-slate-400"
                      }`}
                    >
                      {status}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Session List */}
            <SectionTitle
              title={`Sessions (${filteredSessions.length})`}
            />

            {filteredSessions.length === 0 ? (
              <Card className="mb-4">
                <View className="items-center py-8">
                  <MaterialIcons
                    name="event-busy"
                    size={40}
                    color="#334155"
                  />
                  <Text className="text-slate-500 text-sm mt-3 font-medium">
                    No sessions found.
                  </Text>
                </View>
              </Card>
            ) : (
              filteredSessions.map((session: any) => {
                const isOpen =
                  session.status?.toUpperCase() === "OPEN";
                const discrepancy = Number(session.discrepancy || 0);
                const hasDiscrepancy = Math.abs(discrepancy) > 0.01;
                const isExpanded = expandedId === session.id;

                return (
                  <TouchableOpacity
                    key={session.id}
                    onPress={() =>
                      setExpandedId(isExpanded ? null : session.id)
                    }
                    activeOpacity={0.7}
                    className="mb-3"
                  >
                    <Card>
                      {/* Top row */}
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-row items-center gap-2">
                          <View
                            className={`w-2.5 h-2.5 rounded-full ${isOpen ? "bg-emerald-400" : "bg-slate-500"}`}
                          />
                          <Text className="text-white font-bold text-sm">
                            {isOpen ? "OPEN" : "CLOSED"}
                          </Text>
                          {hasDiscrepancy && (
                            <Pill
                              label={`${discrepancy > 0 ? "+" : ""}${formatCurrency(discrepancy)}`}
                              tone="rose"
                            />
                          )}
                        </View>
                        <MaterialIcons
                          name={
                            isExpanded ? "expand-less" : "expand-more"
                          }
                          size={20}
                          color="#64748b"
                        />
                      </View>

                      {/* Staff & Store */}
                      <View className="flex-row items-center gap-2 mb-2">
                        <MaterialIcons
                          name="person"
                          size={14}
                          color="#64748b"
                        />
                        <Text className="text-slate-300 text-xs font-semibold">
                          {getStaffName(session.userId)}
                        </Text>
                        <Text className="text-slate-600">·</Text>
                        <MaterialIcons
                          name="store"
                          size={14}
                          color="#64748b"
                        />
                        <Text className="text-slate-300 text-xs">
                          {getStoreName(session.storeId)}
                        </Text>
                      </View>

                      {/* Time */}
                      <View className="flex-row items-center gap-1">
                        <MaterialIcons
                          name="schedule"
                          size={12}
                          color="#475569"
                        />
                        <Text className="text-slate-500 text-[10px]">
                          Opened: {formatDate(session.openedAt)}
                        </Text>
                        {session.closedAt && (
                          <>
                            <Text className="text-slate-600 text-[10px]">
                              →
                            </Text>
                            <Text className="text-slate-500 text-[10px]">
                              Closed: {formatDate(session.closedAt)}
                            </Text>
                          </>
                        )}
                      </View>

                      {/* Expanded details */}
                      {isExpanded && (
                        <View className="mt-4 pt-3 border-t border-white/5">
                          <View className="flex-row flex-wrap gap-y-3">
                            <View className="w-1/2">
                              <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                Opening Balance
                              </Text>
                              <Text className="text-white text-base font-bold mt-0.5">
                                {formatCurrency(session.openingBalance)}
                              </Text>
                            </View>
                            <View className="w-1/2">
                              <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                Closing Balance
                              </Text>
                              <Text className="text-white text-base font-bold mt-0.5">
                                {session.closingBalance != null
                                  ? formatCurrency(session.closingBalance)
                                  : "—"}
                              </Text>
                            </View>
                            <View className="w-1/2">
                              <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                Expected
                              </Text>
                              <Text className="text-sky-300 text-base font-bold mt-0.5">
                                {session.expectedBalance != null
                                  ? formatCurrency(session.expectedBalance)
                                  : "—"}
                              </Text>
                            </View>
                            <View className="w-1/2">
                              <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                Discrepancy
                              </Text>
                              <Text
                                className={`text-base font-bold mt-0.5 ${
                                  hasDiscrepancy
                                    ? "text-rose-400"
                                    : "text-emerald-400"
                                }`}
                              >
                                {formatCurrency(discrepancy)}
                              </Text>
                            </View>
                          </View>

                          {/* Sales breakdown */}
                          <View className="mt-3 pt-3 border-t border-white/5">
                            <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">
                              Sales Breakdown
                            </Text>
                            <View className="flex-row justify-between">
                              <View className="items-center flex-1">
                                <MaterialIcons
                                  name="payments"
                                  size={16}
                                  color="#34d399"
                                />
                                <Text className="text-emerald-400 font-bold text-sm mt-1">
                                  {formatCurrency(session.cashSales)}
                                </Text>
                                <Text className="text-slate-500 text-[9px] font-bold uppercase">
                                  Cash
                                </Text>
                              </View>
                              <View className="items-center flex-1">
                                <MaterialIcons
                                  name="credit-card"
                                  size={16}
                                  color="#60a5fa"
                                />
                                <Text className="text-blue-400 font-bold text-sm mt-1">
                                  {formatCurrency(session.cardSales)}
                                </Text>
                                <Text className="text-slate-500 text-[9px] font-bold uppercase">
                                  Card
                                </Text>
                              </View>
                              <View className="items-center flex-1">
                                <MaterialIcons
                                  name="phone-android"
                                  size={16}
                                  color="#c084fc"
                                />
                                <Text className="text-purple-400 font-bold text-sm mt-1">
                                  {formatCurrency(session.digitalSales)}
                                </Text>
                                <Text className="text-slate-500 text-[9px] font-bold uppercase">
                                  Digital
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Notes */}
                          {session.notes && (
                            <View className="mt-3 pt-3 border-t border-white/5">
                              <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                                Notes
                              </Text>
                              <Text className="text-slate-300 text-xs leading-4">
                                {session.notes}
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </Card>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}

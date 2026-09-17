import {
  Card,
  Header,
  Pill,
  Screen,
  SectionTitle,
} from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { useGetPlatformAuditLogsQuery } from "@/services/api/remoteApi";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type FilterAction = "ALL" | "CREATE" | "UPDATE" | "DELETE";

const ACTION_CONFIG: Record<
  string,
  { icon: keyof typeof MaterialIcons.glyphMap; color: string; bg: string }
> = {
  CREATE: { icon: "add-circle", color: "#34d399", bg: "#34d39915" },
  UPDATE: { icon: "edit", color: "#60a5fa", bg: "#60a5fa15" },
  DELETE: { icon: "delete", color: "#f87171", bg: "#f8717115" },
  LOGIN: { icon: "login", color: "#c084fc", bg: "#c084fc15" },
  LOGOUT: { icon: "logout", color: "#94a3b8", bg: "#94a3b815" },
  EXPORT: { icon: "file-download", color: "#fbbf24", bg: "#fbbf2415" },
  IMPORT: { icon: "file-upload", color: "#fbbf24", bg: "#fbbf2415" },
  VOID: { icon: "block", color: "#f87171", bg: "#f8717115" },
  APPROVE: { icon: "check-circle", color: "#34d399", bg: "#34d39915" },
  REJECT: { icon: "cancel", color: "#f87171", bg: "#f8717115" },
};

const DEFAULT_ACTION_CONFIG = {
  icon: "info" as keyof typeof MaterialIcons.glyphMap,
  color: "#64748b",
  bg: "#64748b15",
};

export default function AuditLogsScreen() {
  const { user } = useAppSelector((state) => state.auth);
  const [filterAction, setFilterAction] = useState<FilterAction>("ALL");
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 30;

  const {
    data: response,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useGetPlatformAuditLogsQuery({
    page,
    limit,
    action: filterAction === "ALL" ? undefined : filterAction,
  });

  const logs = (response as any)?.logs ?? [];
  const meta = (response as any)?.meta ?? {
    total: 0,
    page: 1,
    totalPages: 1,
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
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

  const getActionConfig = (action: string) => {
    return ACTION_CONFIG[action?.toUpperCase()] || DEFAULT_ACTION_CONFIG;
  };

  const renderJsonData = (label: string, data: any) => {
    if (!data) return null;
    const entries = typeof data === "object" ? Object.entries(data) : [];
    if (entries.length === 0) return null;

    return (
      <View className="mt-2">
        <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
          {label}
        </Text>
        {entries.slice(0, 8).map(([key, value]) => (
          <View key={key} className="flex-row justify-between py-0.5">
            <Text className="text-slate-400 text-[11px] font-medium">
              {key}
            </Text>
            <Text
              className="text-slate-300 text-[11px] max-w-[60%] text-right"
              numberOfLines={1}
            >
              {String(value ?? "—")}
            </Text>
          </View>
        ))}
        {entries.length > 8 && (
          <Text className="text-slate-600 text-[10px] mt-1">
            +{entries.length - 8} more fields...
          </Text>
        )}
      </View>
    );
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
              eyebrow="Security"
              title="Audit Trail"
              subtitle="Track all system changes"
              right={
                <Pill
                  label={meta.total ? `${meta.total} entries` : "—"}
                  tone="sky"
                />
              }
            />
          </View>
        </View>

        {/* Network status warning */}
        {error && (
          <View className="mx-5 mb-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-3 flex-row items-center gap-2">
            <MaterialIcons name="cloud-off" size={18} color="#f87171" />
            <View className="flex-1">
              <Text className="text-rose-300 text-xs font-bold">
                Requires Internet Connection
              </Text>
              <Text className="text-rose-400/60 text-[10px] mt-0.5">
                Audit logs are fetched from the server. Please check
                your connection.
              </Text>
            </View>
          </View>
        )}

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text className="text-slate-400 mt-4 font-medium">
              Fetching audit trail...
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
            {/* Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mb-4"
              contentContainerStyle={{ gap: 8 }}
            >
              {(["ALL", "CREATE", "UPDATE", "DELETE"] as FilterAction[]).map(
                (action) => {
                  const active = filterAction === action;
                  return (
                    <TouchableOpacity
                      key={action}
                      onPress={() => {
                        setFilterAction(action);
                        setPage(1);
                      }}
                      className={`rounded-full border px-3.5 py-2 flex-row items-center gap-1.5 ${
                        active
                          ? "border-sky-400/40 bg-sky-500/20"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          active ? "text-sky-200" : "text-slate-400"
                        }`}
                      >
                        {action}
                      </Text>
                    </TouchableOpacity>
                  );
                },
              )}
            </ScrollView>

            {/* Audit Log List */}
            <SectionTitle
              title={`Audit Entries (${logs.length})`}
            />

            {logs.length === 0 && !isFetching ? (
              <Card className="mb-4">
                <View className="items-center py-8">
                  <MaterialIcons
                    name="security"
                    size={40}
                    color="#334155"
                  />
                  <Text className="text-slate-500 text-sm mt-3 font-medium">
                    No audit log entries found.
                  </Text>
                </View>
              </Card>
            ) : (
              logs.map((log: any) => {
                const actionKey = log.action?.toUpperCase() || "UPDATE";
                const config = getActionConfig(actionKey);
                const isExpanded = expandedId === log.id;

                return (
                  <TouchableOpacity
                    key={log.id}
                    onPress={() =>
                      setExpandedId(isExpanded ? null : log.id)
                    }
                    activeOpacity={0.7}
                    className="mb-2.5"
                  >
                    <Card>
                      <View className="flex-row items-center gap-2.5">
                        <View
                          className="w-8 h-8 rounded-full items-center justify-center"
                          style={{ backgroundColor: config.bg }}
                        >
                          <MaterialIcons
                            name={config.icon}
                            size={16}
                            color={config.color}
                          />
                        </View>
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text className="text-white text-sm font-bold">
                              {actionKey}
                            </Text>
                            <Pill
                              label={log.entity || "—"}
                              tone="sky"
                            />
                          </View>
                          <View className="flex-row items-center gap-1.5 mt-1">
                            <MaterialIcons
                              name="person"
                              size={11}
                              color="#475569"
                            />
                            <Text className="text-slate-400 text-[10px] font-semibold">
                              {log.user?.name || "System"}
                            </Text>
                            <Text className="text-slate-600">·</Text>
                            <Text className="text-slate-500 text-[10px]">
                              {formatDate(log.createdAt)}
                            </Text>
                          </View>
                        </View>
                        <MaterialIcons
                          name={
                            isExpanded ? "expand-less" : "expand-more"
                          }
                          size={20}
                          color="#64748b"
                        />
                      </View>

                      {/* Expanded details */}
                      {isExpanded && (
                        <View className="mt-3 pt-3 border-t border-white/5">
                          {/* Entity ID */}
                          <View className="flex-row items-center gap-1.5 mb-2">
                            <MaterialIcons
                              name="fingerprint"
                              size={12}
                              color="#475569"
                            />
                            <Text className="text-slate-500 text-[10px]">
                              Entity ID: {log.entityId || "—"}
                            </Text>
                          </View>

                          {/* User details */}
                          {log.user && (
                            <View className="flex-row items-center gap-1.5 mb-2">
                              <MaterialIcons
                                name="badge"
                                size={12}
                                color="#475569"
                              />
                              <Text className="text-slate-500 text-[10px]">
                                {log.user.name} ({log.user.role})
                              </Text>
                            </View>
                          )}

                          {/* IP / User Agent */}
                          {log.ipAddress && (
                            <View className="flex-row items-center gap-1.5 mb-2">
                              <MaterialIcons
                                name="language"
                                size={12}
                                color="#475569"
                              />
                              <Text className="text-slate-500 text-[10px]">
                                IP: {log.ipAddress}
                              </Text>
                            </View>
                          )}

                          {/* Changes / Old Data / New Data */}
                          {renderJsonData("Changes", log.changes)}
                          {renderJsonData("Previous Data", log.oldData)}
                          {renderJsonData("New Data", log.newData)}
                        </View>
                      )}
                    </Card>
                  </TouchableOpacity>
                );
              })
            )}

            {/* Pagination */}
            {meta.totalPages > 1 && (
              <View className="flex-row items-center justify-center gap-4 mt-4 mb-6">
                <TouchableOpacity
                  onPress={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className={`rounded-full border px-4 py-2 ${
                    page <= 1
                      ? "border-slate-800 opacity-40"
                      : "border-sky-500/30 bg-sky-500/10"
                  }`}
                >
                  <Text className="text-sky-200 text-xs font-bold">
                    ← Previous
                  </Text>
                </TouchableOpacity>

                <Text className="text-slate-400 text-xs font-bold">
                  Page {page} of {meta.totalPages}
                </Text>

                <TouchableOpacity
                  onPress={() =>
                    setPage(Math.min(meta.totalPages, page + 1))
                  }
                  disabled={page >= meta.totalPages}
                  className={`rounded-full border px-4 py-2 ${
                    page >= meta.totalPages
                      ? "border-slate-800 opacity-40"
                      : "border-sky-500/30 bg-sky-500/10"
                  }`}
                >
                  <Text className="text-sky-200 text-xs font-bold">
                    Next →
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isFetching && !isLoading && (
              <View className="items-center py-4">
                <ActivityIndicator size="small" color="#38bdf8" />
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}

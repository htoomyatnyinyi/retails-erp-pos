import { Card, Header, Screen } from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import {
  useCreateTenantApiKeyMutation,
  useCreateWebhookMutation,
  useDeleteTenantApiKeyMutation,
  useDeleteWebhookMutation,
  useGetTenantApiKeysQuery,
  useGetWebhooksQuery,
  useUpdateWebhookMutation,
} from "@/services/api/remoteApi";
import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const EVENTS = ["order.created", "order.completed", "expense.created", "store_setting.created", "store_setting.updated"];

export default function IntegrationsScreen() {
  const user = useAppSelector((state) => state.auth.user);
  const { data: rawHooks, refetch: refetchHooks } = useGetWebhooksQuery({ page: 1, limit: 100 });
  const { data: rawKeys, refetch: refetchKeys } = useGetTenantApiKeysQuery();
  const [createHook] = useCreateWebhookMutation();
  const [updateHook] = useUpdateWebhookMutation();
  const [deleteHook] = useDeleteWebhookMutation();
  const [createKey] = useCreateTenantApiKeyMutation();
  const [deleteKey] = useDeleteTenantApiKeyMutation();
  const [webhookModal, setWebhookModal] = useState(false);
  const [keyModal, setKeyModal] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(["order.created"]);
  const hooks = (rawHooks as any)?.webhooks ?? [];
  const keys = Array.isArray(rawKeys) ? rawKeys as any[] : (rawKeys as any)?.apiKeys ?? [];

  const createWebhook = async () => {
    try {
      if (!name.trim() || !/^https?:\/\//i.test(url) || !events.length) throw new Error("Enter a name, an http(s) URL, and at least one event.");
      await createHook({ name: name.trim(), url: url.trim(), events, secret: secret || undefined }).unwrap();
      setWebhookModal(false); setName(""); setUrl(""); setSecret(""); await refetchHooks();
    } catch (error: any) { Alert.alert("Webhook not created", error?.data?.message || error?.message || "Try again."); }
  };
  const createApiKey = async () => {
    try {
      if (!user?.id || !name.trim()) throw new Error("Enter a key name.");
      const result: any = await createKey({ userId: user.id, name: name.trim(), permissions: ["READ", "WRITE"] }).unwrap();
      setKeyModal(false); setName(""); await refetchKeys();
      Alert.alert("Save this secret now", `Key: ${result.apiKey?.key}\n\nSecret: ${result.apiKey?.secret}\n\nThe secret cannot be shown again.`);
    } catch (error: any) { Alert.alert("API key not created", error?.data?.message || error?.message || "Try again."); }
  };
  const confirm = (title: string, action: () => Promise<any>) => Alert.alert(title, "This action cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Confirm", style: "destructive", onPress: () => void action() }]);

  return <Screen><SafeAreaView className="flex-1"><ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
    <Header eyebrow="Admin only" title="Integrations" subtitle="Webhooks send POS events to your systems. API keys are for server-to-server access." />
    <Card className="mb-4"><View className="flex-row justify-between items-center"><View><Text className="text-white font-bold">Webhooks</Text><Text className="text-slate-400 text-xs mt-1">Signed POST deliveries with delivery history.</Text></View><TouchableOpacity className="rounded-xl bg-sky-500/20 p-3" onPress={() => { setName(""); setUrl(""); setSecret(""); setEvents(["order.created"]); setWebhookModal(true); }}><MaterialIcons name="add" color="#7dd3fc" size={20} /></TouchableOpacity></View></Card>
    {hooks.map((hook: any) => <Card key={hook.id} className="mb-3"><View className="flex-row justify-between"><View className="flex-1 mr-3"><Text className="text-white font-bold">{hook.name}</Text><Text className="text-slate-400 text-xs mt-1" numberOfLines={1}>{hook.url}</Text><Text className="text-sky-300 text-xs mt-2">{hook.events?.join(", ")}</Text></View><View className="items-end"><Switch value={hook.isActive} onValueChange={async (isActive) => { await updateHook({ id: hook.id, isActive }).unwrap(); refetchHooks(); }} /><TouchableOpacity className="mt-3" onPress={() => confirm("Remove webhook?", async () => { await deleteHook(hook.id).unwrap(); refetchHooks(); })}><MaterialIcons name="delete-outline" color="#f87171" size={20} /></TouchableOpacity></View></View></Card>)}
    {!hooks.length && <Text className="text-center text-slate-500 mb-5">No webhooks configured.</Text>}
    <Card className="mb-4"><View className="flex-row justify-between items-center"><View><Text className="text-white font-bold">API Keys</Text><Text className="text-slate-400 text-xs mt-1">Never put these in the mobile app or frontend code.</Text></View><TouchableOpacity className="rounded-xl bg-violet-500/20 p-3" onPress={() => { setName(""); setKeyModal(true); }}><MaterialIcons name="key" color="#c4b5fd" size={20} /></TouchableOpacity></View></Card>
    {keys.map((key: any) => <Card key={key.id} className="mb-3"><View className="flex-row justify-between"><View><Text className="text-white font-bold">{key.name}</Text><Text className="text-slate-400 text-xs mt-1">{key.key} • {key.permissions?.join(", ")}</Text></View><TouchableOpacity onPress={() => confirm("Revoke API key?", async () => { await deleteKey(key.id).unwrap(); refetchKeys(); })}><MaterialIcons name="delete-outline" color="#f87171" size={22} /></TouchableOpacity></View></Card>)}
    <Modal visible={webhookModal || keyModal} transparent animationType="slide"><View className="flex-1 justify-end bg-black/60"><View className="rounded-t-3xl bg-slate-900 p-6"><Text className="text-xl font-bold text-white">{webhookModal ? "New Webhook" : "New API Key"}</Text><TextInput className="mt-4 rounded-xl bg-slate-950 border border-slate-700 p-3 text-white" placeholder="Name" placeholderTextColor="#64748b" value={name} onChangeText={setName} />{webhookModal && <><TextInput className="mt-3 rounded-xl bg-slate-950 border border-slate-700 p-3 text-white" placeholder="https://example.com/webhooks/pos" placeholderTextColor="#64748b" value={url} onChangeText={setUrl} autoCapitalize="none" /><TextInput className="mt-3 rounded-xl bg-slate-950 border border-slate-700 p-3 text-white" placeholder="Signing secret (optional)" placeholderTextColor="#64748b" value={secret} onChangeText={setSecret} autoCapitalize="none" /><Text className="text-slate-300 text-xs mt-4">Events</Text><View className="flex-row flex-wrap gap-2 mt-2">{EVENTS.map((event) => <TouchableOpacity key={event} onPress={() => setEvents((old) => old.includes(event) ? old.filter((item) => item !== event) : [...old, event])} className={`rounded-full px-3 py-2 ${events.includes(event) ? "bg-sky-500/30" : "bg-white/10"}`}><Text className="text-xs text-white">{event}</Text></TouchableOpacity>)}</View></>}<View className="flex-row gap-3 mt-6"><TouchableOpacity className="flex-1 rounded-xl bg-white/10 p-3" onPress={() => { setWebhookModal(false); setKeyModal(false); }}><Text className="text-center text-white">Cancel</Text></TouchableOpacity><TouchableOpacity className="flex-1 rounded-xl bg-sky-500 p-3" onPress={() => webhookModal ? void createWebhook() : void createApiKey()}><Text className="text-center font-bold text-slate-950">Create</Text></TouchableOpacity></View></View></View></Modal>
  </ScrollView></SafeAreaView></Screen>;
}

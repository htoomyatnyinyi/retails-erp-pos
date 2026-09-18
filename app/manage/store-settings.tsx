import { ActionButton, Card, Header, Screen } from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import {
  useGetLocalStoreSettingsQuery,
  useSaveLocalStoreSettingMutation,
} from "@/services/features/offline/localApi";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ActivityIndicator, Modal, NativeModules, PermissionsAndroid, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { runMigrations } from "@/services/offline/db";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";

let BleManager: any = null;
let BluetoothClassic: any = null;
try {
  if (NativeModules.BleManager) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("react-native-ble-manager");
    BleManager = module.default || module;
  }
  if (Platform.OS === "android" && NativeModules.RNBluetoothClassic) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("react-native-bluetooth-classic");
    BluetoothClassic = module.default || module;
  }
} catch {}

const fields = [
  { key: "tax_rate", label: "Tax rate (%)", fallback: "0", description: "Applied to taxable items at checkout" },
  { key: "currency_symbol", label: "Currency symbol", fallback: "$", description: "Shown on the POS checkout" },
  { key: "receipt_header", label: "Receipt header", fallback: "", description: "Printed above receipt details" },
  { key: "receipt_footer", label: "Receipt footer", fallback: "Thank you!", description: "Printed at the end of receipts" },
  { key: "thermal_printer_name", label: "Thermal printer name", fallback: "", description: "Label for the paired receipt printer" },
  { key: "thermal_paper_width", label: "Thermal paper width (mm)", fallback: "80", description: "Receipt layout width: usually 58 or 80" },
  { key: "auto_print_receipt", label: "Auto-print receipt (true/false)", fallback: "false", description: "Print immediately after an order when a printer is connected" },
] as const;

export default function StoreSettingsScreen() {
  const { user, currentStoreId } = useAppSelector((state) => state.auth);
  const { data: settings = [], isFetching } = useGetLocalStoreSettingsQuery(
    { storeId: currentStoreId || "" },
    { skip: !currentStoreId },
  );
  const [saveSetting, { isLoading }] = useSaveLocalStoreSettingMutation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [printerModalVisible, setPrinterModalVisible] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const requestBluetoothPermissions = async () => {
    if (Platform.OS !== "android") return true;
    const permissions = Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
  };

  const scanPrinters = async () => {
    if (!BluetoothClassic && !BleManager) {
      Alert.alert("Bluetooth unavailable", "Install a native build with Bluetooth printer support.");
      return;
    }
    try {
      if (!(await requestBluetoothPermissions())) {
        Alert.alert("Permission needed", "Allow Nearby devices / Bluetooth permission to search printers.");
        return;
      }
      setScanning(true);
      setDevices([]);
      if (Platform.OS === "android" && BluetoothClassic) {
        if (!(await BluetoothClassic.isBluetoothEnabled())) await BluetoothClassic.requestBluetoothEnabled();
        const paired = await BluetoothClassic.getBondedDevices();
        const found = await BluetoothClassic.startDiscovery();
        const unique = [...paired, ...found].map((device: any) => ({
          id: device.address || device.id, address: device.address || device.id,
          name: device.name || "Unnamed Bluetooth printer", bonded: device.bonded, transport: "classic",
        })).filter((device: any, index: number, rows: any[]) => rows.findIndex((row) => row.id === device.id) === index);
        setDevices(unique);
        setScanning(false);
        return;
      }
      await BleManager.start?.({ showAlert: false });
      BleManager.onDiscoverPeripheral((device: any) => setDevices((rows) => {
        const printer = { ...device, name: device.name || device.advertising?.localName || "Unnamed BLE printer", transport: "ble" };
        return rows.some((row) => row.id === printer.id) ? rows : [...rows, printer];
      }));
      BleManager.onStopScan(() => setScanning(false));
      await BleManager.scan({ seconds: 8, allowDuplicates: false });
    } catch (error: any) {
      Alert.alert("Scan error", error?.message || "Unable to search Bluetooth printers.");
      setScanning(false);
    }
  };

  const connectPrinter = async (device: any) => {
    try {
      setConnecting(true);
      let saved: any;
      if (device.transport === "classic") {
        let printer = device;
        if (!device.bonded) printer = await BluetoothClassic.pairDevice(device.address || device.id);
        const connected = await BluetoothClassic.connectToDevice(printer.address || printer.id);
        saved = { id: connected.address || printer.address || device.id, name: connected.name || printer.name || device.name, transport: "classic" };
      } else {
        await BleManager.connect(device.id);
        const peripheral = await BleManager.retrieveServices(device.id);
        const characteristic = peripheral.characteristics?.find((item: any) => item.properties?.Write || item.properties?.WriteWithoutResponse);
        if (!characteristic) throw new Error("Printer has no writable Bluetooth characteristic.");
        saved = { id: device.id, name: device.name, transport: "ble", writeCharacteristic: { service: characteristic.service, characteristic: characteristic.characteristic, withoutResponse: Boolean(characteristic.properties?.WriteWithoutResponse) } };
      }
      await AsyncStorage.setItem("selected_printer", JSON.stringify(saved));
      setValues((previous) => ({ ...previous, thermal_printer_name: saved.name }));
      setPrinterModalVisible(false);
      Alert.alert("Printer connected", `${saved.name} selected. Tap Save Store Settings to sync its name.`);
    } catch (error: any) {
      Alert.alert("Connection error", error?.message || "Could not connect to this printer.");
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const found = (settings as any[]).find((row) => row.settingKey === field.key);
      next[field.key] = String(found?.settingValue ?? field.fallback);
    }
    // RTK Query may provide a new empty-array reference during refetches.
    // Do not enqueue a state update unless the actual form values changed.
    setValues((previous) => {
      const unchanged = fields.every(
        (field) => previous[field.key] === next[field.key],
      );
      return unchanged ? previous : next;
    });
  }, [settings]);

  const save = async () => {
    if (!user?.tenantId || !currentStoreId) return;
    const tax = Number(values.tax_rate);
    const paperWidth = Number(values.thermal_paper_width);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      Alert.alert("Invalid tax rate", "Enter a value between 0 and 100.");
      return;
    }
    if (![58, 80].includes(paperWidth)) {
      Alert.alert("Invalid paper width", "Thermal paper width must be 58 or 80 mm.");
      return;
    }
    try {
      // This also upgrades installs that opened this screen before the app
      // initialization finished. Save serially: concurrent SQLite writes can
      // otherwise produce a transient "database is locked" error on Android.
      await runMigrations();
      for (const [index, field] of fields.entries()) {
        const settingValue = field.key === "tax_rate"
          ? tax
          : field.key === "thermal_paper_width"
            ? paperWidth
            : values[field.key] ?? field.fallback;
        await saveSetting({
          tenantId: user.tenantId,
          storeId: currentStoreId,
          settingKey: field.key,
          settingValue,
          description: field.description,
          syncNow: index === fields.length - 1,
        }).unwrap();
      }
      Alert.alert("Saved", "Settings are saved locally and will sync automatically.");
      router.back();
    } catch (error: any) {
      console.error("Store settings save failed", error);
      const message =
        error?.data?.message ||
        error?.message ||
        (typeof error === "string" ? error : null) ||
        "Unable to save store settings.";
      Alert.alert("Save failed", message);
    }
  };

  return (
    <Screen>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
          <Header eyebrow="Configuration" title="Store Settings" subtitle="These values are cached on this device for offline checkout." />
          {!currentStoreId ? (
            <Card><Text className="text-amber-300">Select a store in Manage before editing its settings.</Text></Card>
          ) : (
            <>
              <Card className="mb-4">
                <Text className="text-xs text-sky-300 uppercase tracking-widest">Offline-first</Text>
                <Text className="text-slate-400 text-xs mt-2">Changes apply locally immediately; an internet connection is only needed to sync them to other devices.</Text>
              </Card>
              <Card className="mb-3">
                <Text className="text-white font-bold">Bluetooth Thermal Printer</Text>
                <Text className="text-slate-400 text-xs mt-1">Search paired or nearby printers, then connect and select one for receipts.</Text>
                <TouchableOpacity className="mt-3 flex-row items-center justify-center rounded-xl bg-sky-500/20 p-3" onPress={() => setPrinterModalVisible(true)}>
                  <MaterialIcons name="bluetooth-searching" size={20} color="#38bdf8" />
                  <Text className="ml-2 font-bold text-sky-300">Search / Connect Printer</Text>
                </TouchableOpacity>
              </Card>
              {fields.map((field) => (
                <Card key={field.key} className="mb-3">
                  <Text className="text-white font-bold">{field.label}</Text>
                  <Text className="text-slate-400 text-xs mt-1">{field.description}</Text>
                  <TextInput
                    value={values[field.key] ?? field.fallback}
                    onChangeText={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
                    keyboardType={field.key === "tax_rate" ? "decimal-pad" : "default"}
                    className="mt-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-white"
                    placeholderTextColor="#64748b"
                  />
                </Card>
              ))}
              <View className="mt-2">
                <ActionButton title={isLoading || isFetching ? "Saving..." : "Save Store Settings"} icon="save" onPress={save} disabled={isLoading || isFetching} />
              </View>
            </>
          )}
        </ScrollView>
        <Modal visible={printerModalVisible} transparent animationType="slide" onRequestClose={() => setPrinterModalVisible(false)}>
          <View className="flex-1 justify-end bg-black/60">
            <View className="max-h-[80%] rounded-t-3xl bg-slate-900 p-6">
              <View className="mb-4 flex-row items-center justify-between"><Text className="text-xl font-bold text-white">Bluetooth Printers</Text><TouchableOpacity onPress={() => setPrinterModalVisible(false)}><MaterialIcons name="close" size={24} color="#94a3b8" /></TouchableOpacity></View>
              <TouchableOpacity className="mb-4 flex-row items-center justify-center rounded-xl bg-sky-500/20 p-3" onPress={scanPrinters} disabled={scanning}>
                <MaterialIcons name="bluetooth-searching" size={20} color="#38bdf8" /><Text className="ml-2 font-bold text-sky-300">{scanning ? "Scanning..." : "Scan for Printers"}</Text>
              </TouchableOpacity>
              {scanning && <ActivityIndicator className="mb-3" color="#38bdf8" />}
              <ScrollView>{devices.map((device) => <TouchableOpacity key={device.id} className="mb-2 rounded-xl border border-white/10 bg-white/5 p-4" onPress={() => connectPrinter(device)} disabled={connecting}><Text className="font-semibold text-white">{device.name}</Text><Text className="mt-1 text-xs text-slate-400">{device.id}</Text>{connecting && <ActivityIndicator className="mt-2" color="#38bdf8" />}</TouchableOpacity>)}{!devices.length && !scanning && <Text className="py-8 text-center text-slate-400">Tap scan to find printers</Text>}</ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Screen>
  );
}

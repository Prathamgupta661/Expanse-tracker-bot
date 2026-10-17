import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppState,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  ensureNotificationPermission,
  ensureSmsPermission,
  startSmsListener,
  stopSmsListener,
} from "./src/lib/capture";
import {
  clearCaptureLog,
  readCaptureLog,
  readListenerSeen,
  updateCaptureLogResult,
  type CaptureLogEntry,
  type ListenerSeen,
} from "./src/lib/capture-log";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "./src/lib/config";
import { flushQueue, sendOrQueue, sendOrQueueDetailed } from "./src/lib/ingest";
import type { CaptureConfig } from "./src/lib/types";

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry}
        autoCapitalize="none"
      />
    </View>
  );
}

function ActionButton(props: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={props.onPress}>
      <Text style={styles.buttonText}>{props.title}</Text>
    </TouchableOpacity>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Skipped or dropped entries never reached the server's expense list, so allow a manual send. */
function canResend(entry: CaptureLogEntry): boolean {
  return entry.result.startsWith("skipped") || entry.result.startsWith("dropped");
}

export default function App() {
  const [config, setConfig] = useState<CaptureConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState("Idle");
  const [captureLog, setCaptureLog] = useState<CaptureLogEntry[]>([]);
  const [listenerSeen, setListenerSeen] = useState<ListenerSeen | null>(null);

  const refreshLog = useCallback(async () => {
    const [entries, seen] = await Promise.all([readCaptureLog(), readListenerSeen()]);
    setCaptureLog(entries);
    setListenerSeen(seen);
  }, []);

  // Captures happen in the background, so reload the log whenever the app comes back to the front.
  useEffect(() => {
    void refreshLog();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshLog();
      }
    });
    return () => subscription.remove();
  }, [refreshLog]);

  const canSend = useMemo(() => {
    return !!config.baseUrl.trim() && !!config.userId.trim() && !!config.secret.trim();
  }, [config]);

  useEffect(() => {
    loadConfig().then((saved) => {
      setConfig(saved);
      if (saved.smsEnabled) {
        void startSmsListener(saved);
      }
      void flushQueue(saved).catch(() => undefined);
    });

    return () => {
      stopSmsListener();
    };
  }, []);

  const persist = async (next: CaptureConfig) => {
    setConfig(next);
    await saveConfig(next);
  };

  const onSave = async () => {
    await persist(config);
    if (config.smsEnabled) {
      await startSmsListener(config);
    } else {
      stopSmsListener();
    }
    setStatus("Settings saved");
  };

  const onGrantNotification = async () => {
    const granted = await ensureNotificationPermission();
    setStatus(granted ? "Notification access granted" : "Notification access not granted");
  };

  const onGrantSms = async () => {
    const granted = await ensureSmsPermission();
    if (granted && config.smsEnabled) {
      await startSmsListener(config);
    }
    setStatus(granted ? "SMS permission granted" : "SMS permission denied");
  };

  const onSendTest = async () => {
    if (!canSend) {
      Alert.alert("Missing config", "Please set backend URL, user UUID, and secret.");
      return;
    }

    const ok = await sendOrQueue(config, {
      eventId: `test:${Date.now()}`,
      channel: "notification",
      message: "UPI payment of Rs 199 paid to Test Merchant",
      appOrSender: "expense-capture-test",
      capturedAt: new Date().toISOString(),
    });

    setStatus(ok ? "Test event sent" : "Test event queued");
  };

  const onFlushQueue = async () => {
    const result = await flushQueue(config);
    setStatus(`Queue flush: sent ${result.sent}, failed ${result.failed}, dropped ${result.dropped}`);
  };

  const onResendEntry = async (entry: CaptureLogEntry) => {
    if (!canSend) {
      Alert.alert("Missing config", "Please set backend URL, user UUID, and secret.");
      return;
    }

    // A stable event id lets the server dedupe repeated taps on the same entry.
    const result = await sendOrQueueDetailed(config, {
      eventId: `resend:${entry.channel}:${entry.at}`,
      channel: entry.channel,
      message: entry.preview,
      appOrSender: entry.source,
      capturedAt: entry.at,
    });
    await updateCaptureLogResult(entry.at, `resent: ${result}`);
    await refreshLog();
    setStatus(`Resend: ${result}`);
  };

  const onClearLog = async () => {
    await clearCaptureLog();
    await refreshLog();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Expense Capture (React Native)</Text>
        <Text style={styles.subtitle}>
          {"Notification listener + SMS fallback -> /api/ingest/mobile"}
        </Text>

        <View style={styles.switchRow}>
          <Text style={styles.label}>Enable Notification Capture</Text>
          <Switch
            value={config.notificationEnabled}
            onValueChange={(value) => setConfig((prev) => ({ ...prev, notificationEnabled: value }))}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.label}>Enable SMS Fallback</Text>
          <Switch
            value={config.smsEnabled}
            onValueChange={(value) => setConfig((prev) => ({ ...prev, smsEnabled: value }))}
          />
        </View>

        <Field
          label="Backend URL"
          value={config.baseUrl}
          onChangeText={(value) => setConfig((prev) => ({ ...prev, baseUrl: value }))}
        />
        <Field
          label="User UUID"
          value={config.userId}
          onChangeText={(value) => setConfig((prev) => ({ ...prev, userId: value }))}
        />
        <Field
          label="MOBILE_INGEST_SECRET"
          value={config.secret}
          secureTextEntry
          onChangeText={(value) => setConfig((prev) => ({ ...prev, secret: value }))}
        />
        <Field
          label="Notification app filters (comma-separated package ids)"
          value={config.appFilters}
          onChangeText={(value) => setConfig((prev) => ({ ...prev, appFilters: value }))}
        />
        <Field
          label="SMS sender filters (comma-separated)"
          value={config.smsFilters}
          onChangeText={(value) => setConfig((prev) => ({ ...prev, smsFilters: value }))}
        />

        <ActionButton title="Save Settings" onPress={() => void onSave()} />
        <ActionButton title="Grant Notification Access" onPress={() => void onGrantNotification()} />
        <ActionButton title="Grant SMS Permission" onPress={() => void onGrantSms()} />
        <ActionButton title="Send Test Event" onPress={() => void onSendTest()} />
        <ActionButton title="Flush Queue" onPress={() => void onFlushQueue()} />

        <Text style={styles.status}>Status: {status}</Text>

        <Text style={styles.sectionTitle}>Recent captures</Text>
        <Text style={styles.label}>
          {listenerSeen
            ? `Notification listener last fired: ${formatTime(listenerSeen.at)} (${listenerSeen.source ?? "unknown app"})`
            : "Notification listener has not fired yet"}
        </Text>
        <ActionButton title="Refresh Log" onPress={() => void refreshLog()} />
        <ActionButton title="Clear Log" onPress={() => void onClearLog()} />

        {captureLog.length === 0 ? (
          <Text style={styles.label}>No payment-like notifications or SMS seen yet.</Text>
        ) : (
          captureLog.map((entry) => (
            <View key={`${entry.at}-${entry.preview}`} style={styles.logEntry}>
              <Text style={styles.logMeta}>
                {formatTime(entry.at)} · {entry.channel} · {entry.source ?? "unknown"}
              </Text>
              <Text style={styles.logResult}>{entry.result}</Text>
              <Text style={styles.logPreview} numberOfLines={4}>
                {entry.preview}
              </Text>
              {canResend(entry) ? (
                <ActionButton title="Send to server" onPress={() => void onResendEntry(entry)} />
              ) : null}
            </View>
          ))
        )}

        <Text style={styles.footer}>Made by Pratham</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  content: {
    padding: 16,
    gap: 8,
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    color: "#cbd5e1",
    marginBottom: 8,
  },
  label: {
    color: "#cbd5e1",
    marginBottom: 4,
  },
  fieldWrap: {
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  button: {
    backgroundColor: "#0ea5e9",
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  buttonText: {
    color: "#020617",
    fontWeight: "700",
    textAlign: "center",
  },
  status: {
    marginTop: 14,
    color: "#93c5fd",
    fontSize: 14,
  },
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 20,
  },
  logEntry: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  logMeta: {
    color: "#94a3b8",
    fontSize: 12,
  },
  logResult: {
    color: "#facc15",
    fontWeight: "700",
    marginVertical: 4,
  },
  logPreview: {
    color: "#cbd5e1",
    fontSize: 13,
  },
  footer: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "center",
    marginTop: 24,
    marginBottom: 8,
  },
});

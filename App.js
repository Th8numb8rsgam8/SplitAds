import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Platform, SafeAreaView, StatusBar } from 'react-native';

// 🚀 DYNAMIC LAYER: Load the correct MQTT engine based on environment
let mqttConnect;
if (Platform.OS === 'web') {
  // Browser fallback configuration for web environments (like Expo Snack)
  require('react_native_mqtt').default({ size: 10000, storageBackend: localStorage });
} else {
  // High-performance Native TCP module for iOS/Android Cloud Emulators & Physical Phones
  mqttConnect = require('expo-mqtt').mqttConnect;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('Initializing connection...');

  useEffect(() => {
    // ⚙️ ENTERPRISE CLUSTER CONFIGURATION
    const clusterHost = 'xxxxxx.s1.eu.hivemq.cloud'; // 👈 Replace with your HiveMQ Host URL
    const username = 'your_username';               // 👈 Replace with your Cluster Username
    const password = 'your_password';               // 👈 Replace with your Cluster Password
    const targetTopic = 'pi/sensors/data';           // 👈 The topic your Raspberry Pi emits to
    const clientID = `MobileClient_${Math.random().toString(16).substring(2, 8)}`;

    const establishMQTT = async () => {
      // ==========================================
      // BRANCH A: WEB FRAMEWORK (WebSockets over TLS)
      // ==========================================
      if (Platform.OS === 'web') {
        setStatus('Connecting via WebSockets (Port 8884)...');
        const client = new window.Paho.MQTT.Client(clusterHost, 8884, '/mqtt', clientID);

        client.onConnectionLost = (err) => setStatus(`Disconnected: ${err.errorMessage}`);
        client.onMessageArrived = (msg) => setMessages((prev) => [msg.payloadString, ...prev]);

        client.connect({
          useSSL: true,
          userName: username,
          password: password,
          onSuccess: () => {
            setStatus('Connected! Listening to HiveMQ Cloud...');
            client.subscribe(targetTopic);
          },
          onFailure: (err) => setStatus(`Web Connection Failed: ${err.errorMessage}`),
        });

        return () => { if (client.isConnected()) client.disconnect(); };
      } 
      
      // ==========================================
      // BRANCH B: NATIVE EMULATOR/PHONE (Native TCP over TLS)
      // ==========================================
      else {
        setStatus('Connecting via Native TCP (Port 8883)...');
        try {
          const client = await mqttConnect({
            uri: `ssl://${clusterHost}:8883`, // 👈 Uses highly secure raw TCP TLS
            clientId: clientID,
            user: username,
            pass: password,
            keepAlive: 60,
          });

          setStatus('Connected Natively! Listening to HiveMQ Cloud...');
          
          // Native module subscription call
          await client.subscribe(targetTopic, 0);

          // Native event listener pipeline
          client.on('message', (topic, msg) => {
            setMessages((prev) => [msg.toString(), ...prev]);
          });

        } catch (err) {
          setStatus(`Native Connection Failed: ${err.message || err}`);
          console.error(err);
        }
      }
    };

    establishMQTT();
  }, []);

  return (
    // SafeAreaView protects the interface layout from device notches and camera islands
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.card}>
        <Text style={styles.title}>IoT Telemetry Core</Text>
        <Text style={[styles.status, status.includes('Connected') ? styles.connected : styles.disconnected]}>
          ● {status}
        </Text>
      </View>

      <Text style={styles.subHeader}>Live Stream Feed:</Text>
      
      <ScrollView style={styles.terminalWindow}>
        {messages.length === 0 ? (
          <Text style={styles.placeholderText}>Waiting for data payload from Raspberry Pi...</Text>
        ) : (
          messages.map((payload, index) => (
            <Text key={index} style={styles.terminalLine}>
              [{new Date().toLocaleTimeString()}] ➔ {payload}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  card: { backgroundColor: '#1a1a1e', borderRadius: 12, padding: 20, marginTop: 20, borderLeftWidth: 4, borderLeftColor: '#00cc66', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#ffffff', marginBottom: 6 },
  status: { fontSize: 13, fontWeight: '600' },
  connected: { color: '#00cc66' },
  disconnected: { color: '#ff3333' },
  subHeader: { fontSize: 14, fontWeight: '700', color: '#8e8e93', marginTop: 25, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },
  terminalWindow: { flex: 1, backgroundColor: '#000000', borderRadius: 8, padding: 15, borderWidth: 1, borderColor: '#2c2c2e' },
  terminalLine: { fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: '#33ff33', fontSize: 13, paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#1c1c1e' },
  placeholderText: { color: '#48484a', fontStyle: 'italic', textAlign: 'center', marginTop: 40, fontSize: 14 }
});
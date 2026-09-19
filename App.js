import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

const bleManager = new BleManager();
const BACKEND_URL = 'https://YOUR_NGROK_SUBDOMAIN.ngrok-free.app';

const PROVISION_SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const PROVISION_CHARACTERISTIC_UUID = '87654321-4321-4321-4321-cba987654321';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!\%*?&]{8,}$/;

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);

  if (!currentUser) {
    return <SignupScreen onSignupSuccess={(user) => setCurrentUser(user)} />;
  }

  return <DeviceDashboard user={currentUser} onLogout={() => setCurrentUser(null)} />;
}

// ----------------------------------------------------------------------------
// SIGNUP SCREEN
// ----------------------------------------------------------------------------
function SignupScreen({ onSignupSuccess }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!username.trim() || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }

    if (!STRONG_PASSWORD_REGEX.test(password)) {
      Alert.alert(
        'Validation Error',
        'Password must be 8+ characters and contain uppercase, lowercase, number, & special character.'
      );
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert('Success', 'User created successfully!');
        onSignupSuccess(data.user);
      } else {
        Alert.alert('Signup Failed', data.error || 'Something went wrong');
      }
    } catch (error) {
      Alert.alert('Network Error', 'Could not connect to backend service.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>IoT Registration</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor="#888"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Email Address"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />

        <TouchableOpacity style={styles.button} onPress={handleSignup} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// DASHBOARD SCREEN
// ----------------------------------------------------------------------------
function DeviceDashboard({ user, onLogout }) {
  const [devices, setDevices] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/devices/${user.id}`);
      const data = await response.json();
      if (response.ok) {
        setDevices(data.devices || []);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to load user devices.');
    } finally {
      setFetching(false);
    }
  };

  return (
    <View style={styles.dashboardContainer}>
      <View style={styles.headerRow}>
        <Text style={styles.welcomeText}>Hello, {user.username}</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
        <Text style={styles.addButtonText}>+ Add Edge Device (BLE)</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Your Devices</Text>

      {fetching ? (
        <ActivityIndicator color="#007AFF" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.deviceCard}>
              <Text style={styles.deviceName}>{item.device_name}</Text>
              <Text style={styles.deviceTopic}>Topic: {item.mqtt_topic}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No devices added yet.</Text>}
        />
      )}

      <Modal visible={modalVisible} animationType="slide">
        <AddDeviceBLEModal
          user={user}
          onClose={() => setModalVisible(false)}
          onSuccess={() => {
            setModalVisible(false);
            fetchDevices();
          }}
        />
      </Modal>
    </View>
  );
}

// ----------------------------------------------------------------------------
// BLE MODAL (Using JWT Setup Token)
// ----------------------------------------------------------------------------
function AddDeviceBLEModal({ user, onClose, onSuccess }) {
  const [deviceName, setDeviceName] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');

  const requestBLEPermissions = async () => {
    if (Platform.OS === 'android') {
      // Android 12+ (API 31+) requires explicit Bluetooth permissions
      if (Platform.Version >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        return (
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED
        );
      } 
      // Android 11 and lower require Fine Location permission to perform BLE scans
      else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }

    // iOS permissions are handled automatically via Info.plist at runtime
    return true;
  }

  const handleStartOnboarding = async () => {
    if (!deviceName.trim() || !wifiSsid.trim()) {
      Alert.alert('Validation Error', 'Device Name and Wi-Fi SSID are required.');
      return;
    }

    setLoading(true);

    try {
      // Step 1: Request signed JWT setup token from Express
      setStatusText('Generating JWT setup token...');
      const response = await fetch(`${BACKEND_URL}/api/devices/request-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, deviceName }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to request setup');

      const setupToken = data.setupToken; // Signed JWT token

      // Step 2: Scan for BLE Hardware
      setStatusText('Scanning for BLE hardware...');
      bleManager.startDeviceScan(
        [PROVISION_SERVICE_UUID], 
        null, 
        async (error, device) => {
          if (error) {
            bleManager.stopDeviceScan();
            setLoading(false);
            Alert.alert('BLE Error', error.message);
            return;
          }

        if (device) {
          bleManager.stopDeviceScan();
          setStatusText('Connecting via BLE...');

          const connectedDevice = await device.connect();
          await connectedDevice.discoverAllServicesAndCharacteristics();

          // Step 3: Transmit Wi-Fi Credentials + JWT Payload
          setStatusText('Sending configuration...');
          const payload = JSON.stringify({
            ssid: wifiSsid,
            pass: wifiPassword,
            token: setupToken, // Send signed JWT over BLE
          });

          const base64Payload = Buffer.from(payload).toString('base64');

          await connectedDevice.writeCharacteristicWithResponseForService(
            PROVISION_SERVICE_UUID,
            PROVISION_CHARACTERISTIC_UUID,
            base64Payload
          );

          setStatusText('Device provisioned!');
          Alert.alert('Success', 'Configuration sent over BLE. Hardware is connecting to Wi-Fi!');
          setLoading(false);
          onSuccess();
        }
      });
    } catch (err) {
      setLoading(false);
      Alert.alert('Provisioning Failed', err.message);
    }
  };

  return (
    <View style={styles.modalContainer}>
      <Text style={styles.title}>Provision Edge Device</Text>

      <TextInput
        style={styles.input}
        placeholder="Device Name (e.g., Living Room Thermostat)"
        placeholderTextColor="#888"
        value={deviceName}
        onChangeText={setDeviceName}
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="Wi-Fi SSID"
        placeholderTextColor="#888"
        value={wifiSsid}
        onChangeText={setWifiSsid}
        autoCapitalize="none"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder="Wi-Fi Password"
        placeholderTextColor="#888"
        value={wifiPassword}
        onChangeText={setWifiPassword}
        secureTextEntry
        editable={!loading}
      />

      {loading && <Text style={styles.statusText}>{statusText}</Text>}

      <TouchableOpacity
        style={[styles.button, loading && styles.disabledButton]}
        onPress={handleStartOnboarding}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pair & Transmit over BLE</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={loading}>
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

// ----------------------------------------------------------------------------
// STYLES
// ----------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f5f5f5' },
  dashboardContainer: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#f5f5f5' },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  form: { backgroundColor: '#fff', padding: 20, borderRadius: 10, elevation: 2 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 12, marginBottom: 15, fontSize: 16, backgroundColor: '#fff' },
  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 6, alignItems: 'center' },
  disabledButton: { backgroundColor: '#a0c4ff' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  welcomeText: { fontSize: 20, fontWeight: 'bold' },
  logoutText: { color: '#d9534f', fontWeight: 'bold' },
  addButton: { backgroundColor: '#34c759', padding: 15, borderRadius: 6, alignItems: 'center', marginBottom: 20 },
  addButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  deviceCard: { backgroundColor: '#fff', padding: 15, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#e0e0e0' },
  deviceName: { fontSize: 16, fontWeight: 'bold' },
  deviceTopic: { fontSize: 14, color: '#666', marginTop: 4 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 20 },
  statusText: { color: '#007AFF', textAlign: 'center', marginVertical: 10, fontStyle: 'italic' },
  cancelButton: { marginTop: 15, alignItems: 'center' },
  cancelButtonText: { color: '#888', fontSize: 16 },
});
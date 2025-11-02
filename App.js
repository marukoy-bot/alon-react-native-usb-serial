import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import { UsbSerialManager } from 'react-native-usb-serialport-for-android';

const { width } = Dimensions.get('window');

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [loraConnected, setLoraConnected] = useState(false);
  
  // Radar data
  const [currentAngle, setCurrentAngle] = useState(0);
  const [currentDistance, setCurrentDistance] = useState(0);
  const [radarPoints, setRadarPoints] = useState([]);
  const [detectedFish, setDetectedFish] = useState([]);
  
  // Fish detection parameters
  const DISTANCE_CHANGE_THRESHOLD = 50;
  const lastDistanceRef = useRef({});
  const fishIdCounter = useRef(0);
  const bufferRef = useRef('');
  const serialPortRef = useRef(null);

  useEffect(() => {
    console.log('USB Serial ready');

    return () => {
      if (isConnected && serialPortRef.current) {
        disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (isConnected && serialPortRef.current) {
      // Set up listener for incoming data
      const subscription = serialPortRef.current.onReceived((event) => {
        processData(event.data);
      });

      return () => {
        if (subscription) {
          subscription.remove();
        }
      };
    }
  }, [isConnected]);

  const listDevices = async () => {
    try {
      console.log('Listing USB devices...');
      const deviceList = await UsbSerialManager.list();
      console.log('Available devices:', deviceList);
      
      if (!deviceList || deviceList.length === 0) {
        setDevices([]);
        Alert.alert('No Devices', 'No USB devices found. Please connect your ESP32 via USB OTG cable.');
      } else {
        setDevices(deviceList);
        Alert.alert('Devices Found', `Found ${deviceList.length} USB device(s)`);
      }
    } catch (error) {
      console.error('Error listing devices:', error);
      Alert.alert('Error', `Failed to list USB devices: ${error.message}`);
      setDevices([]);
    }
  };

  const connect = async () => {
    try {
      if (devices.length === 0) {
        Alert.alert('No Devices', 'Please scan for devices first');
        await listDevices();
        return;
      }

      const device = devices[0];
      console.log('Attempting to connect to:', device);
      
      // Check and request permission
      const hasPermission = await UsbSerialManager.hasPermission(device.deviceId);
      
      if (!hasPermission) {
        console.log('Requesting permission...');
        const granted = await UsbSerialManager.tryRequestPermission(device.deviceId);
        
        if (!granted) {
          Alert.alert('Permission Denied', 'USB permission was denied');
          return;
        }
      }

      console.log('Permission granted, opening connection...');
      
      // Open serial port
      const serialPort = await UsbSerialManager.open(device.deviceId, {
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 0,
        dtr: false,
        rts: false,
      });
      
      serialPortRef.current = serialPort;
      setIsConnected(true);
      setDeviceInfo(device);
      Alert.alert('Connected', `USB Serial connected to device`);
      console.log('Successfully connected');
      
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', error.message || 'Failed to connect');
    }
  };

  const disconnect = async () => {
    try {
      if (serialPortRef.current) {
        await serialPortRef.current.close();
        serialPortRef.current = null;
      }
      setIsConnected(false);
      setDeviceInfo(null);
      setLoraConnected(false);
      bufferRef.current = '';
      Alert.alert('Disconnected', 'USB connection closed');
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  };

  const processData = (data) => {
    try {
        // Debug: Log raw bytes
        console.log('Raw bytes:', data);
        
        // Data comes as array of bytes, convert to string
        let text = '';

        // Case 1: data is a string of hex characters (like '7B22616E...')
        if (typeof data === 'string' && /^[0-9A-Fa-f]+$/.test(data)) {
            const bytes = [];
                for (let i = 0; i < data.length; i += 2) {
                    bytes.push(parseInt(data.substr(i, 2), 16));
                }
            text = String.fromCharCode(...bytes);
        }
        // Case 2: data is already Uint8Array or array of numbers
        else if (Array.isArray(data)) {
            text = String.fromCharCode(...data);
        } else {
            text = data.toString();
        }

    console.log('Converted text:', text);
    console.log('Text length:', text.length);

      
      bufferRef.current += text;
      
      // Process complete JSON lines
      const lines = bufferRef.current.split('\n');
      bufferRef.current = lines.pop() || '';
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          try {
            const jsonData = JSON.parse(trimmed);
            console.log('Received JSON:', jsonData);
            
            if (jsonData.angle !== undefined && jsonData.distance !== undefined) {
              // Handle both string and number formats
              const angle = parseFloat(jsonData.angle);
              const distance = parseFloat(jsonData.distance);
              
              // Only update if values are valid numbers
              if (!isNaN(angle) && !isNaN(distance)) {
                setCurrentAngle(angle);
                setCurrentDistance(distance);
              }
              
              // Update LoRa connection status
              if (jsonData.connected !== undefined) {
                setLoraConnected(jsonData.connected);
              }
              
              setRadarPoints(prev => {
                const newPoint = { angle, distance, timestamp: Date.now() };
                return [...prev, newPoint].slice(-360);
              });
              
              detectFish(angle, distance);
            }
            
            if (jsonData.connected !== undefined) {
              setLoraConnected(jsonData.connected);
            }
            
            if (jsonData.status === 'ready') {
              console.log('ESP32 ready');
            }
          } catch (parseError) {
            console.warn('JSON parse error:', parseError);
          }
        }
      });
    } catch (error) {
      console.error('Process data error:', error);
    }
  };

  const detectFish = (angle, distance) => {
    const angleKey = Math.round(angle / 5) * 5;
    const lastDist = lastDistanceRef.current[angleKey];
    
    if (lastDist !== undefined) {
      const distChange = Math.abs(distance - lastDist);
      
      if (distChange > DISTANCE_CHANGE_THRESHOLD && distance > 0) {
        const fishId = `fish_${fishIdCounter.current++}`;
        const newFish = {
          id: fishId,
          angle: angle,
          distance: distance,
          timestamp: Date.now(),
        };
        
        setDetectedFish(prev => {
          const filtered = prev.filter(f => Date.now() - f.timestamp < 30000);
          const exists = filtered.some(f => 
            Math.abs(f.angle - angle) < 10 && 
            Math.abs(f.distance - distance) < 100
          );
          
          if (!exists) {
            return [...filtered, newFish];
          }
          return filtered;
        });
      }
    }
    
    lastDistanceRef.current[angleKey] = distance;
  };

  const sendCommand = async (command) => {
    if (!isConnected || !serialPortRef.current) {
      Alert.alert('Not Connected', 'Please connect to ESP32 first');
      return;
    }

    try {
      // Send as string directly
      await serialPortRef.current.send(command + '\n');
      console.log('Sent:', command);
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Send Error', error.message);
    }
  };

  const clearFish = () => {
    setDetectedFish([]);
    lastDistanceRef.current = {};
  };

  const clearRadar = () => {
    setRadarPoints([]);
    clearFish();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>LoRa Radar</Text>
        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, 
              { backgroundColor: isConnected ? '#4CAF50' : '#F44336' }]} />
            <Text style={styles.statusText}>
              USB: {isConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, 
              { backgroundColor: loraConnected ? '#4CAF50' : '#F44336' }]} />
            <Text style={styles.statusText}>
              LoRa: {loraConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>
        {deviceInfo && (
          <Text style={styles.deviceName}>Device ID: {deviceInfo.deviceId}</Text>
        )}
      </View>

      {/* USB Serial Controls */}
      <View style={styles.controlSection}>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={listDevices}
          >
            <Text style={styles.buttonText}>Scan</Text>
          </TouchableOpacity>
          
          {!isConnected ? (
            <TouchableOpacity
              style={[styles.button, styles.successButton, devices.length === 0 && styles.disabledButton]}
              onPress={connect}
              disabled={devices.length === 0}
            >
              <Text style={styles.buttonText}>Connect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={disconnect}
            >
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, !isConnected && styles.disabledButton]}
            onPress={() => sendCommand('STATUS')}
            disabled={!isConnected}
          >
            <Text style={styles.buttonText}>Status</Text>
          </TouchableOpacity>
        </View>
        
        {devices.length > 0 && !isConnected && (
          <Text style={styles.deviceCount}>
            Found {devices.length} device(s). Tap Connect to connect.
          </Text>
        )}
      </View>

      {/* Radar Display Placeholder */}
      <View style={styles.radarContainer}>
        <Text style={styles.radarPlaceholder}>Radar Display</Text>
        <Text style={styles.radarInfo}>
          Angle: {currentAngle.toFixed(1)}° | Distance: {currentDistance.toFixed(0)} cm
        </Text>
        <Text style={styles.radarInfo}>
          Points: {radarPoints.length}
        </Text>
      </View>

      {/* Data Display */}
      <View style={styles.dataSection}>
        <View style={styles.dataRow}>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>ANGLE</Text>
            <Text style={styles.dataValue}>
              {loraConnected ? `${currentAngle.toFixed(0)}°` : '---'}
            </Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>DISTANCE</Text>
            <Text style={styles.dataValue}>
              {loraConnected ? `${currentDistance.toFixed(0)} cm` : '---'}
            </Text>
          </View>
        </View>
      </View>

      {/* Fish Detection */}
      <View style={styles.fishSection}>
        <View style={styles.fishHeader}>
          <Text style={styles.fishTitle}>
            Detected Fish ({detectedFish.length})
          </Text>
          <TouchableOpacity onPress={clearFish}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.fishList}>
          {detectedFish.length === 0 ? (
            <Text style={styles.noFishText}>No fish detected</Text>
          ) : (
            detectedFish.map((fish, index) => (
              <View key={fish.id} style={styles.fishItem}>
                <Text style={styles.fishText}>
                  #{index + 1}: {fish.angle.toFixed(0)}° at {fish.distance.toFixed(0)} cm
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    backgroundColor: '#2a2a2a',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#00ff00',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00ff00',
    textAlign: 'center',
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
  },
  deviceName: {
    color: '#00ff00',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  controlSection: {
    padding: 12,
    backgroundColor: '#2a2a2a',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
    padding: 10,
    borderRadius: 4,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  primaryButton: {
    backgroundColor: '#2196F3',
  },
  successButton: {
    backgroundColor: '#4CAF50',
  },
  dangerButton: {
    backgroundColor: '#F44336',
  },
  secondaryButton: {
    backgroundColor: '#666',
  },
  disabledButton: {
    backgroundColor: '#444',
    opacity: 0.5,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  deviceCount: {
    color: '#00ff00',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  radarContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radarPlaceholder: {
    color: '#00ff00',
    fontSize: 18,
    marginBottom: 20,
  },
  radarInfo: {
    color: '#fff',
    fontSize: 14,
    marginVertical: 4,
  },
  dataSection: {
    backgroundColor: '#2a2a2a',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#00ff00',
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  dataItem: {
    alignItems: 'center',
  },
  dataLabel: {
    color: '#00ff00',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  dataValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  fishSection: {
    backgroundColor: '#2a2a2a',
    padding: 16,
    maxHeight: 150,
  },
  fishHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fishTitle: {
    color: '#00ff00',
    fontSize: 16,
    fontWeight: 'bold',
  },
  clearText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: 'bold',
  },
  fishList: {
    maxHeight: 100,
  },
  noFishText: {
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  fishItem: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  fishText: {
    color: '#fff',
    fontSize: 14,
  },
});

export default App;
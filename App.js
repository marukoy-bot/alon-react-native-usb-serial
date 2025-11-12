import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Button, StyleSheet, ScrollView, TouchableOpacity, DeviceEventEmitter, Alert, Dimensions } from 'react-native';
import { UsbSerial, UsbSerialManager } from 'react-native-usb-serialport-for-android';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { StatusBar } from 'react-native/types_generated/index';
import { clear } from 'react-native/types_generated/Libraries/LogBox/Data/LogBoxData';

const { width } = Dimensions.get('window');

export default function App() {
    const [devices, setDevices] = useState([]);
    const [isUSBConnected, setConnected] = useState(false);
    const [loraConnected, setLoraConnected] = useState(false);
    
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [angle, setAngle] = useState(0);
    const [distance, setDistance] = useState(0);
    const [port, setPort] = useState(null);
    const readLoopRef = useRef(null);
    const [displayAngle, setDisplayAngle] = useState(0);
    const targetAngleRef = useRef(0);


    const [currentAngle, setCurrentAngle] = useState(0);
    const [currentDistance, setCurrentDistance] = useState(0);
    const [radarPoints, setRadarPoints] = useState([]);
    const [detectedFish, setDetectedFish] = useState([]);

    const DISTANCE_CHANGE_THRESHOLD = 50;
    const lastDistanceRef = useRef({});
    const fishIdCounter = useRef(0);
    const bufferRef = useRef('');
    const serialPortRef = useRef(null);

    useEffect(() => {
        console.log('USB Serial ready.');
        return () => {
            if (isUSBConnected && serialPortRef.current) {
                disconnect();
            }
        };
    }, [])

    useEffect(() => {
        if (isUSBConnected && serialPortRef.current){
            const subscription = serialPortRef.current.onReceived((event) => {
                processData(event.data);
            });

            return () => {
                if (subscription) {
                    subscription.remove();
                }
            };
        }        
    }, [isUSBConnected]);

    useEffect(() => {
        let animationFrame;
        
        const animate = () => {
            setDisplayAngle(prev => {
                const target = targetAngleRef.current;
                const diff = target - prev;

                if (Math.abs(diff) < 0.5) {
                    return target;
                }

                return prev + diff * 0.1;
            });
            animationFrame = requestAnimationFrame(animate);
        };

        animationFrame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrame);
    }, []);

    const scanDevices = async () => {
        try {
            const deviceList = await UsbSerialManager.list();
            console.log('Devices:', deviceList);

            if (!deviceList || deviceList.length === 0) {
                setDevices([]);
                Alert.alert('No Devices', 'No USB Devices found. Please Connect the ESP32 via USB OTG.');
            }
            else {
                setDevices(deviceList);
            }
        } catch (err) {
            console.error('Scan error:', err);
            Alert.alert('Error', `Failed to list USB Devices: ${err.message}`);
            setDevices([]);
        }
    };

    const connectDevice = async (device) => {
        try {
            if (!device) {
                if (devices.length === 0) {
                    Alert.alert('No Devices', 'Please scan for devices first');
                    await scanDevices();
                    return;
                }
            device = devices[0];
            }

            console.log('Attempting to connect to:', device);

            const hasPermission = await UsbSerialManager.hasPermission(device.deviceId);

            if (!hasPermission) {
                console.log('Requesting permission...');
                const granted = await UsbSerialManager.tryRequestPermission(device.deviceId);

                if (!granted) {
                    Alert.alert('Permission Denied', 'USB Permission was denied');
                    return;
                }              
            }

            const port = await UsbSerialManager.open(device.deviceId, {
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                parity: 0,
                dtr: true,
                rts: true,
            });

            serialPortRef.current = port;
            setConnected(true);
            setSelectedDevice(device);
            console.log('✅ USB device connected');

            // Listen for data events
            DeviceEventEmitter.addListener('onReceivedData', (event) => {
            try {
                if (!event || !event.data) return;

                const text = new TextDecoder().decode(event.data);
                const lines = text.trim().split('\n');

                lines.forEach((line) => {
                try {
                    const jsonData = JSON.parse(line);

                    // ✅ Update LoRa status
                    if (jsonData.connected !== undefined) {
                        setLoraConnected(jsonData.connected === true);
                    }

                    // ✅ Handle radar angle & distance
                    if (jsonData.angle !== undefined && jsonData.distance !== undefined) {
                        const a = parseFloat(jsonData.angle);
                        const d = parseFloat(jsonData.distance);
                    if (!isNaN(a) && !isNaN(d)) {
                        //setAngle(a);
                        targetAngleRef.current(a);
                        setDistance(d);
                        setCurrentAngle(a);
                        setCurrentDistance(d);
                        setRadarPoints((prev) => {
                        const newPoint = { angle: a, distance: d, timestamp: Date.now() };
                            return [...prev, newPoint].slice(-360);
                        });
                        detectFish(a, d);
                    }
                    }
                } catch (err) {
                    console.log('Invalid JSON:', line);
                }
                });
            } catch (err) {
                console.log('USB data parse error:', err);
            }
            });

            // Optional: send STATUS command right after connect
        } catch (err) {
            console.log('Connection failed:', err);
            Alert.alert('Connection Error', err.message);
        }
    };

    const processData = (data) => {
        try {
            console.log('Raw bytes: ', data);
            let text = '';

            if (typeof data === 'string' && /^[0-9A-Fa-f]+$/.test(data)) {
                const bytes = [];
                for (let i = 0; i < data.length; i += 2) {
                    bytes.push(parseInt(data.substr(i, 2), 16));
                }
                text = String.fromCharCode(...bytes);
            } else if (Array.isArray(data)) {
                text = String.fromCharCode(...data);
            } else {
                text = data.toString();
            }

            console.log('Converted text:', text);
            console.log('Text length:', text.length);

            bufferRef.current += text;

            const lines = bufferRef.current.split('\n');
            bufferRef.current = lines.pop() || '';

            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('{')) {
                    try {
                        const jsonData = JSON.parse(trimmed);
                        console.log('Received JSON:', jsonData);

                        if (jsonData.angle !== undefined && jsonData.distance !== undefined) {
                            const a = parseFloat(jsonData.angle);
                            const d = parseFloat(jsonData.distance);
                            const loraConnection = Boolean(jsonData.loraConnected);
                            
                            if (!isNaN(a) && !isNaN(d)) {
                                targetAngleRef.current = a;
                                setDistance(d);
                                setCurrentAngle(a);
                                setCurrentDistance(d);
                                setRadarPoints(prev => {
                                    const newPoint = {angle: a, distance: d, timestamp: Date.now()};
                                    return [...prev, newPoint].slice(-360);
                                });
                                detectFish(a, d);
                            }
                            
                            setLoraConnected(loraConnection);

                            if (jsonData.connected !== undefined) {
                                setLoraConnected(jsonData.connected);
                            }
                        }          
                    }
                    catch (parseError) {
                        console.warn('JSON parse error:', parseError);
                    }
                }
            });
        }
        catch (error) {
            console.error('Process Data Error:', error);
        }        
    };

    const disconnectDevice = async () => {
        try {
            if (readLoopRef.current) clearInterval(readLoopRef.current);
                if (port) {
                    await port.close();
                    console.log('Disconnected');
                }
            setConnected(false);
            setSelectedDevice(null);
            setPort(null);
        } catch (err) {
        console.error('Disconnect error:', err);
        }
    };

    const detectFish = (angle, distance) => {
        const angleKey = Math.round(angle / 5) * 5;
        const lastDist = lastDistanceRef.current[angleKey];
        
        if (lastDist !== undefined) {
        const distChange = Math.abs(distance - lastDist);
        
            if (distChange > DISTANCE_CHANGE_THRESHOLD && distance > 0) {            
                setDetectedFish(prev => {
                    const filtered = prev.filter(f => Date.now() - f.timestamp < 30000);
                    const exists = filtered.some(f => 
                        Math.abs(f.angle - angle) < 10 && 
                        Math.abs(f.distance - distance) < 100
                    );

                    if (exists) return filtered;

                    const fishId = `fish_${fishIdCounter.current++}`;
                    const newFish = {
                        id: fishId,
                        angle: angle,
                        distance: distance,
                        timestamp: Date.now(),
                    };

                    const updated = [newFish, ...filtered].slice(0, 10);
                    return updated;
                });
            }
        }
        
        lastDistanceRef.current[angleKey] = distance;
    };

    const sendCommand = async (command) => {
        if (!isUSBConnected || !serialPortRef.current) {
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
    
    const radarRadius = 150;
    const radarCenter = { x: 200, y: 200 };
    const sweepAngle = (angle * Math.PI) / 180;
    const blipDistance = Math.min(distance, radarRadius);
    const blipX = radarCenter.x + blipDistance * Math.sin(sweepAngle);
    const blipY = radarCenter.y - blipDistance * Math.cos(sweepAngle);

    return (
        <View style={styles.container}>
        <ScrollView style={styles.scrollView}>

        {/* USB Serial Controls */}
        <View style={styles.card}>
        <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Alon USB</Text>
            <TouchableOpacity style={styles.button} onPress={scanDevices}>
                <Text style={styles.buttonText}>Scan</Text>
            </TouchableOpacity>
        </View>
            
        {!isUSBConnected ? (
        devices.length > 0 ? (
            <View style={styles.deviceList}>
                {devices.map((d, i) => (
                    <TouchableOpacity
                    key={i}
                    title={`Connect ${d.deviceName || 'Device ' + (i + 1)}`}
                    style={styles.deviceButton}
                    onPress={() => connectDevice(d)}
                    >
                        <Text style={styles.deviceButtonText}>
                            Connect to {d.deviceName || `Device ${i + 1}`}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
            ) : (
                <Text style={styles.info}>No devices found. Tap Scan to search</Text>
            )
        ) : (
        <TouchableOpacity style={[styles.button, styles.disconnectButton]} title="Disconnect" onPress={disconnectDevice}>
            <Text style={styles.buttonText}>Disconnect</Text>    
        </TouchableOpacity>
        )}

        {/* LoRa Status */}
        <View style={styles.loraStatus}>
            <View style={[styles.statusDot, 
                {backgroundColor: loraConnected ? '#00ff44' : '#ff4444'}]}/>
            <Text style={styles.statusText}>
                LoRa: {loraConnected ? 'Connected' : 'Disconnected'}
            </Text>
            </View>
        </View>
        

        {/* Radar Display card*/}
        <View style={styles.radarContainer}>
        <Svg height="400" width="400">
        {/* Radar rings with top-center distance labels */}
        {[50, 100, 150].map((r, i) => (
            <React.Fragment key={`ring-${r}`}>
            <Circle
                cx={radarCenter.x}
                cy={radarCenter.y}
                r={r}
                stroke="green"
                strokeWidth="1"
                fill="none"
            />
            <SvgText
                x={radarCenter.x}
                y={radarCenter.y - r - 8}  // slightly above each ring
                fill="green"
                fontSize="12"
                textAnchor="middle"
                alignmentBaseline="middle">
                {r * 20} cm
            </SvgText>
            </React.Fragment>
        ))}

        {/* Sweep line */}
        <Line
            x1={radarCenter.x}
            y1={radarCenter.y}
            x2={radarCenter.x + radarRadius * Math.sin((displayAngle * Math.PI) / 180)}
            y2={radarCenter.y - radarRadius * Math.cos((displayAngle * Math.PI) / 180)}
            stroke="lime"
            strokeWidth="2"
        />

        {/* Radar points and fish icons */}
        {radarPoints.map((p, i) => {
            const scaledDist = (p.distance / 3000) * radarRadius;
            const x = radarCenter.x + scaledDist * Math.sin((p.angle * Math.PI) / 180);
            const y = radarCenter.y - scaledDist * Math.cos((p.angle * Math.PI) / 180);

            const isFish = detectedFish.some(
                f => Math.abs(f.angle - p.angle) < 5 && Math.abs(f.distance - p.distance) < 100
            );

            const age = Date.now() - p.timestamp;
            const opacity = Math.max(0, 1 - age / 5000);

            return (
            <React.Fragment key={`point-${i}`}>
                {isFish ? (
                <SvgText
                    x={x}
                    y={y}
                    fontSize="14"
                    fill="yellow"
                    opacity={opacity}
                    textAnchor="middle"
                    alignmentBaseline="middle">
                    🐟
                </SvgText>
                ) : (
                <Circle cx={x} cy={y} r="3" fill="green" fillOpacity={opacity}/>
                )}
            </React.Fragment>
            );
        })}
        </Svg>

        </View>



        {/* Debug info */}
        <Text style={styles.angleDistanceText}>
            Angle: {currentAngle.toFixed(1)}° | Distance: {currentDistance.toFixed(1)} cm
        </Text>
        

        {/* Fish Detection Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>
              Detected Fish ({detectedFish.length})
            </Text>
            <TouchableOpacity onPress={clearFish}>
              <Text style={styles.normalText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.fishList}>
            {detectedFish.length === 0 ? (
              <Text style={styles.normalText}>No fish detected</Text>
            ) : (
              detectedFish.map((fish, index) => (
                <View key={fish.id} style={styles.fishItem}>
                  <Text style={styles.normalText}>
                    #{index + 1}: {fish.angle.toFixed(0)}° at {fish.distance.toFixed(0)} cm
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>      

        </ScrollView>
        </View>  
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
        paddingTop: 50,
    },
    image: {
        width: '100%',
        height: '100%',
        fel: 1,
        resizeMode: 'cover',
        justifyContent: 'center',
    },
    header: {
        color: '#9b87f5',
        fontSize: 24,
        fontWeight: 'bold',
        marginTop: 20,
        marginBottom: 10,
    },    
    button: {
        backgroundColor: '#9b87f5',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    disconnectButton: {
        backgroundColor: '#ff4444',
        marginTop: 10,
    },
    buttonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    card: {
        borderWidth: 2,
        borderColor: '#9b87f5',
        borderRadius: 15,
        padding: 15,
        marginBottom: 10,
        backgroundColor: '#2a2a2a',
    },
    cardTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 0,
    },
    connected: {
        color: '#00ff44',
    },
    disconnected: {
        color: '#ff4444',
    },
    label: {
        color: '#fff',
        fontSize: 12,
        marginBottom: 5,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
    },
    info: {
        color: '#666',
        fontSize: 14,
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 10,
    },
    radarContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: -10,
        marginBottom: 20,
    },
    debug: {
        color: 'lime',
        fontSize: 16,
        marginTop: 10,
    },
    radarCard: {
        borderWidth: 2,
        borderColor: '#9b87f5',
        borderRadius: 15,
        padding: 5,  // Less padding for radar card
        marginBottom: 10,
        backgroundColor: '#2a2a2a',
    },
    title: {
        color: 'white',
        fontSize: 42,
        fontWeight: 'bold',
        textAlign: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        marginBottom: 120,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    scrollView: {
        flex: 1,
        padding: 10,
    },
    deviceList: {
        marginTop: 10,
    },
    deviceListTitle: {
        color: '#fff',
        fontSize: 14,
        marginBottom: 8,
    },
    deviceButton: {
        backgroundColor: '#00ff44',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 15,
        marginBottom: 8,
    },
    deviceButtonText: {
        color: '#1a1a1a',
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    radarCard: {
        borderWidth: 2,
        borderColor: '#9b87f5',
        borderRadius: 15,
        padding: 15,
        marginBottom: 10,
        backgroundColor: '#2a2a2a',
    },
    statusDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: 8,
    },
    statusText: {
        color: '#fff',
        fontSize: 14,
    },
    loraStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    angleDistanceText: {
        color: '#fff',
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 10,
    },
    normalText: {
        color: '#fff',
    },

});

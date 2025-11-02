import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Circle, Line, Text as SvgText, Path } from 'react-native-svg';

const { width } = Dimensions.get('window');
const RADAR_SIZE = Math.min(width - 32, 400);
const CENTER = RADAR_SIZE / 2;

const RadarDisplay = ({ angle, distance, points, detectedFish, isConnected }) => {
  const MAX_DISTANCE = 2000; // cm - adjust based on your max range

  // Convert polar coordinates to cartesian
  const polarToCartesian = (angle, distance) => {
    const radius = (distance / MAX_DISTANCE) * (CENTER - 20);
    const angleRad = (angle - 90) * (Math.PI / 180); // -90 to start from top
    
    return {
      x: CENTER + radius * Math.cos(angleRad),
      y: CENTER + radius * Math.sin(angleRad),
    };
  };

  // Draw radar grid circles
  const renderGridCircles = () => {
    const circles = [];
    const distances = [500, 1000, 1500, 2000];
    
    distances.forEach((dist, index) => {
      const radius = (dist / MAX_DISTANCE) * (CENTER - 20);
      circles.push(
        <Circle
          key={`circle-${index}`}
          cx={CENTER}
          cy={CENTER}
          r={radius}
          stroke="#00ff00"
          strokeWidth="1"
          fill="none"
          opacity="0.3"
        />
      );
      
      // Distance labels
      circles.push(
        <SvgText
          key={`label-${index}`}
          x={CENTER}
          y={CENTER - radius - 5}
          fill="#00ff00"
          fontSize="10"
          textAnchor="middle"
        >
          {dist} cm
        </SvgText>
      );
    });
    
    return circles;
  };

  // Draw radar angle lines
  const renderAngleLines = () => {
    const lines = [];
    const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
    
    angles.forEach((deg, index) => {
      const pos = polarToCartesian(deg, MAX_DISTANCE);
      lines.push(
        <Line
          key={`line-${index}`}
          x1={CENTER}
          y1={CENTER}
          x2={pos.x}
          y2={pos.y}
          stroke="#00ff00"
          strokeWidth="1"
          opacity="0.2"
        />
      );
    });
    
    return lines;
  };

  // Draw sweep line (current angle)
  const renderSweepLine = () => {
    if (!isConnected) return null;
    
    const pos = polarToCartesian(angle, MAX_DISTANCE);
    
    return (
      <>
        <Line
          x1={CENTER}
          y1={CENTER}
          x2={pos.x}
          y2={pos.y}
          stroke="#00ff00"
          strokeWidth="2"
          opacity="0.8"
        />
        <Circle
          cx={pos.x}
          cy={pos.y}
          r="3"
          fill="#00ff00"
        />
      </>
    );
  };

  // Draw detected points
  const renderPoints = () => {
    if (!isConnected) return null;
    
    return points.map((point, index) => {
      const age = Date.now() - point.timestamp;
      const opacity = Math.max(0.1, 1 - age / 5000); // Fade over 5 seconds
      
      if (point.distance > 0 && point.distance < MAX_DISTANCE) {
        const pos = polarToCartesian(point.angle, point.distance);
        
        return (
          <Circle
            key={`point-${index}`}
            cx={pos.x}
            cy={pos.y}
            r="2"
            fill="#00ff00"
            opacity={opacity}
          />
        );
      }
      return null;
    });
  };

  // Draw detected fish
  const renderFish = () => {
    return detectedFish.map((fish, index) => {
      if (fish.distance > 0 && fish.distance < MAX_DISTANCE) {
        const pos = polarToCartesian(fish.angle, fish.distance);
        const age = Date.now() - fish.timestamp;
        const opacity = Math.max(0.3, 1 - age / 30000); // Fade over 30 seconds
        
        return (
          <React.Fragment key={fish.id}>
            {/* Fish marker - larger circle */}
            <Circle
              cx={pos.x}
              cy={pos.y}
              r="6"
              fill="none"
              stroke="#ff0000"
              strokeWidth="2"
              opacity={opacity}
            />
            <Circle
              cx={pos.x}
              cy={pos.y}
              r="3"
              fill="#ff0000"
              opacity={opacity}
            />
            {/* Pulsing ring animation effect */}
            <Circle
              cx={pos.x}
              cy={pos.y}
              r="10"
              fill="none"
              stroke="#ff0000"
              strokeWidth="1"
              opacity={opacity * 0.5}
            />
          </React.Fragment>
        );
      }
      return null;
    });
  };

  // Draw current position marker
  const renderCurrentPosition = () => {
    if (!isConnected || distance <= 0 || distance >= MAX_DISTANCE) return null;
    
    const pos = polarToCartesian(angle, distance);
    
    return (
      <>
        <Circle
          cx={pos.x}
          cy={pos.y}
          r="4"
          fill="#ffff00"
          opacity="0.8"
        />
        <Circle
          cx={pos.x}
          cy={pos.y}
          r="8"
          fill="none"
          stroke="#ffff00"
          strokeWidth="2"
          opacity="0.6"
        />
      </>
    );
  };

  return (
    <View style={styles.container}>
      <Svg width={RADAR_SIZE} height={RADAR_SIZE} style={styles.radar}>
        {/* Background circle */}
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={CENTER - 10}
          fill="#000"
          stroke="#00ff00"
          strokeWidth="2"
        />
        
        {/* Grid */}
        {renderGridCircles()}
        {renderAngleLines()}
        
        {/* Center point */}
        <Circle
          cx={CENTER}
          cy={CENTER}
          r="4"
          fill="#00ff00"
        />
        
        {/* Data layers */}
        {renderPoints()}
        {renderFish()}
        {renderSweepLine()}
        {renderCurrentPosition()}
        
        {/* Angle markers */}
        <SvgText x={CENTER} y={15} fill="#00ff00" fontSize="12" textAnchor="middle">
          0°
        </SvgText>
        <SvgText x={RADAR_SIZE - 15} y={CENTER + 5} fill="#00ff00" fontSize="12" textAnchor="middle">
          90°
        </SvgText>
        <SvgText x={CENTER} y={RADAR_SIZE - 5} fill="#00ff00" fontSize="12" textAnchor="middle">
          180°
        </SvgText>
        <SvgText x={15} y={CENTER + 5} fill="#00ff00" fontSize="12" textAnchor="middle">
          270°
        </SvgText>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  radar: {
    backgroundColor: '#000',
  },
});

export default RadarDisplay;
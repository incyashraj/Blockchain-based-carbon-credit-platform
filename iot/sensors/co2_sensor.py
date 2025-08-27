#!/usr/bin/env python3
"""
CO2 Sensor Data Collection Module
Simulates MQ-135 or SCD30 CO2 sensor readings for development
In production, this would interface with actual hardware sensors
"""

import time
import json
import random
import hashlib
from datetime import datetime
from typing import Dict, Optional
import paho.mqtt.client as mqtt
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CO2Sensor:
    def __init__(self, sensor_id: str, location: Dict[str, float], mqtt_config: Dict[str, str]):
        """
        Initialize CO2 sensor
        
        Args:
            sensor_id: Unique identifier for the sensor
            location: Dictionary with 'lat' and 'lon' coordinates
            mqtt_config: MQTT broker configuration
        """
        self.sensor_id = sensor_id
        self.location = location
        self.mqtt_config = mqtt_config
        self.client = None
        self.is_connected = False
        
        # Sensor configuration
        self.baseline_co2 = 400  # Normal atmospheric CO2 (ppm)
        self.noise_factor = 0.1  # 10% noise in readings
        self.calibration_offset = random.uniform(-10, 10)  # Sensor calibration drift
        
        # Data quality metrics
        self.total_readings = 0
        self.error_count = 0
        self.last_reading_time = None
        
    def connect_mqtt(self) -> bool:
        """Connect to MQTT broker"""
        try:
            self.client = mqtt.Client(client_id=f"sensor_{self.sensor_id}")
            
            # Set up callbacks
            self.client.on_connect = self._on_connect
            self.client.on_disconnect = self._on_disconnect
            self.client.on_publish = self._on_publish
            
            # Connect to broker
            self.client.connect(
                self.mqtt_config['broker'],
                int(self.mqtt_config['port']),
                60
            )
            
            # Start network loop
            self.client.loop_start()
            
            # Wait for connection
            timeout = 10
            while timeout > 0 and not self.is_connected:
                time.sleep(0.5)
                timeout -= 0.5
            
            return self.is_connected
            
        except Exception as e:
            logger.error(f"Failed to connect to MQTT broker: {e}")
            return False
    
    def _on_connect(self, client, userdata, flags, rc):
        """MQTT connection callback"""
        if rc == 0:
            self.is_connected = True
            logger.info(f"Sensor {self.sensor_id} connected to MQTT broker")
        else:
            logger.error(f"Failed to connect to MQTT broker, return code {rc}")
    
    def _on_disconnect(self, client, userdata, rc):
        """MQTT disconnection callback"""
        self.is_connected = False
        logger.warning(f"Sensor {self.sensor_id} disconnected from MQTT broker")
    
    def _on_publish(self, client, userdata, mid):
        """MQTT publish callback"""
        logger.debug(f"Message {mid} published successfully")
    
    def read_co2(self) -> Optional[float]:
        """
        Simulate CO2 sensor reading
        In production, this would interface with actual sensor hardware
        """
        try:
            # Simulate realistic CO2 variations
            time_factor = time.time() % 86400  # Daily cycle
            seasonal_variation = 15 * random.sin(time_factor / 86400 * 2 * 3.14159)
            
            # Add some realistic patterns:
            # - Higher CO2 in enclosed spaces
            # - Diurnal variations
            # - Random fluctuations
            base_reading = self.baseline_co2 + seasonal_variation
            noise = random.uniform(-self.noise_factor * base_reading, 
                                 self.noise_factor * base_reading)
            
            co2_ppm = base_reading + noise + self.calibration_offset
            
            # Clamp to realistic values (250-5000 ppm)
            co2_ppm = max(250, min(5000, co2_ppm))
            
            self.total_readings += 1
            self.last_reading_time = datetime.utcnow()
            
            return round(co2_ppm, 2)
            
        except Exception as e:
            logger.error(f"Error reading CO2 sensor: {e}")
            self.error_count += 1
            return None
    
    def create_sensor_data(self, co2_reading: float) -> Dict:
        """Create structured sensor data packet"""
        timestamp = datetime.utcnow().isoformat()
        
        # Additional sensor metadata
        sensor_data = {
            'sensor_id': self.sensor_id,
            'timestamp': timestamp,
            'location': self.location,
            'measurements': {
                'co2_ppm': co2_reading,
                'temperature': round(random.uniform(18, 25), 1),  # Simulated temp
                'humidity': round(random.uniform(30, 70), 1),     # Simulated humidity
                'pressure': round(random.uniform(1010, 1020), 1)  # Simulated pressure
            },
            'sensor_status': {
                'calibration_date': (datetime.utcnow().replace(day=1)).isoformat(),
                'battery_level': random.randint(85, 100),
                'signal_strength': random.randint(-70, -30),
                'total_readings': self.total_readings,
                'error_rate': self.error_count / max(1, self.total_readings)
            },
            'data_quality': {
                'accuracy_score': random.uniform(0.92, 0.98),
                'confidence_interval': random.uniform(0.02, 0.08),
                'anomaly_score': random.uniform(0.0, 0.1)
            }
        }
        
        return sensor_data
    
    def generate_data_hash(self, sensor_data: Dict) -> str:
        """Generate SHA-256 hash of sensor data for integrity verification"""
        data_string = json.dumps(sensor_data, sort_keys=True)
        return hashlib.sha256(data_string.encode()).hexdigest()
    
    def publish_data(self, sensor_data: Dict) -> bool:
        """Publish sensor data to MQTT broker"""
        if not self.is_connected:
            logger.error("Not connected to MQTT broker")
            return False
        
        try:
            # Add data hash for integrity
            sensor_data['data_hash'] = self.generate_data_hash(sensor_data)
            
            # Publish to topic
            topic = f"carbon-credits/emissions/{self.sensor_id}"
            payload = json.dumps(sensor_data)
            
            result = self.client.publish(topic, payload, qos=1)
            
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.info(f"Published CO2 reading: {sensor_data['measurements']['co2_ppm']} ppm")
                return True
            else:
                logger.error(f"Failed to publish data: {result.rc}")
                return False
                
        except Exception as e:
            logger.error(f"Error publishing sensor data: {e}")
            return False
    
    def start_monitoring(self, interval: int = 60):
        """
        Start continuous monitoring and data publication
        
        Args:
            interval: Seconds between readings (default: 60)
        """
        logger.info(f"Starting CO2 monitoring for sensor {self.sensor_id}")
        logger.info(f"Reading interval: {interval} seconds")
        
        if not self.connect_mqtt():
            logger.error("Failed to connect to MQTT broker. Exiting.")
            return
        
        try:
            while True:
                # Read sensor
                co2_reading = self.read_co2()
                
                if co2_reading is not None:
                    # Create data packet
                    sensor_data = self.create_sensor_data(co2_reading)
                    
                    # Publish to MQTT
                    success = self.publish_data(sensor_data)
                    
                    if success:
                        logger.info(f"Sensor {self.sensor_id}: CO2={co2_reading}ppm, "
                                  f"Quality={sensor_data['data_quality']['accuracy_score']:.3f}")
                    else:
                        logger.warning("Failed to publish sensor data")
                else:
                    logger.warning("Failed to read sensor data")
                
                # Wait for next reading
                time.sleep(interval)
                
        except KeyboardInterrupt:
            logger.info("Monitoring stopped by user")
        except Exception as e:
            logger.error(f"Monitoring error: {e}")
        finally:
            if self.client:
                self.client.loop_stop()
                self.client.disconnect()
    
    def get_sensor_info(self) -> Dict:
        """Get sensor information and statistics"""
        return {
            'sensor_id': self.sensor_id,
            'location': self.location,
            'status': 'connected' if self.is_connected else 'disconnected',
            'total_readings': self.total_readings,
            'error_count': self.error_count,
            'error_rate': self.error_count / max(1, self.total_readings),
            'last_reading': self.last_reading_time.isoformat() if self.last_reading_time else None
        }

def main():
    """Main function for testing sensor functionality"""
    import os
    from dotenv import load_dotenv
    
    # Load environment variables
    load_dotenv()
    
    # MQTT configuration
    mqtt_config = {
        'broker': os.getenv('MQTT_BROKER', 'localhost'),
        'port': os.getenv('MQTT_PORT', '1883'),
        'username': os.getenv('MQTT_USERNAME', ''),
        'password': os.getenv('MQTT_PASSWORD', '')
    }
    
    # Sensor configuration
    sensor_id = "CO2-SENSOR-001"
    location = {
        'lat': 37.7749,  # San Francisco coordinates for testing
        'lon': -122.4194,
        'altitude': 52,
        'description': 'Test Location - Downtown Office'
    }
    
    # Create and start sensor
    sensor = CO2Sensor(sensor_id, location, mqtt_config)
    
    logger.info("Starting CO2 sensor simulation...")
    logger.info("Press Ctrl+C to stop monitoring")
    
    # Start monitoring with 30-second intervals for testing
    sensor.start_monitoring(interval=30)

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
MQTT Broker Setup and Management
Handles MQTT broker configuration and message routing for IoT sensors
"""

import paho.mqtt.client as mqtt
import json
import logging
import threading
import time
from datetime import datetime
from typing import Dict, Callable, List
from dataclasses import dataclass, asdict

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class MQTTMessage:
    """Structure for MQTT messages"""
    topic: str
    payload: str
    timestamp: datetime
    qos: int
    retain: bool

class MQTTBrokerClient:
    """MQTT client for handling sensor data and forwarding to blockchain oracle"""
    
    def __init__(self, client_id: str, broker_config: Dict[str, str]):
        """
        Initialize MQTT broker client
        
        Args:
            client_id: Unique identifier for this client
            broker_config: MQTT broker connection configuration
        """
        self.client_id = client_id
        self.broker_config = broker_config
        self.client = None
        self.is_connected = False
        
        # Message handling
        self.message_handlers: Dict[str, List[Callable]] = {}
        self.message_history: List[MQTTMessage] = []
        self.max_history = 1000
        
        # Statistics
        self.total_messages_received = 0
        self.total_messages_published = 0
        self.connection_attempts = 0
        self.last_connection_time = None
        
        # Subscription topics
        self.subscriptions = [
            "carbon-credits/emissions/+",          # All emission sensor data
            "carbon-credits/verification/+",       # Verification requests
            "carbon-credits/oracle/+",            # Oracle responses
            "carbon-credits/system/+",            # System messages
        ]
    
    def connect(self) -> bool:
        """Connect to MQTT broker"""
        try:
            self.connection_attempts += 1
            
            # Create MQTT client
            self.client = mqtt.Client(client_id=self.client_id)
            
            # Set up authentication if provided
            if self.broker_config.get('username') and self.broker_config.get('password'):
                self.client.username_pw_set(
                    self.broker_config['username'],
                    self.broker_config['password']
                )
            
            # Set up callbacks
            self.client.on_connect = self._on_connect
            self.client.on_disconnect = self._on_disconnect
            self.client.on_message = self._on_message
            self.client.on_subscribe = self._on_subscribe
            self.client.on_publish = self._on_publish
            
            # Connect to broker
            logger.info(f"Connecting to MQTT broker at {self.broker_config['host']}:{self.broker_config['port']}")
            
            self.client.connect(
                self.broker_config['host'],
                int(self.broker_config['port']),
                60  # keepalive
            )
            
            # Start network loop
            self.client.loop_start()
            
            # Wait for connection with timeout
            timeout = 10
            while timeout > 0 and not self.is_connected:
                time.sleep(0.5)
                timeout -= 0.5
            
            if self.is_connected:
                self.last_connection_time = datetime.utcnow()
                logger.info("Successfully connected to MQTT broker")
                return True
            else:
                logger.error("Failed to connect to MQTT broker within timeout")
                return False
                
        except Exception as e:
            logger.error(f"Failed to connect to MQTT broker: {e}")
            return False
    
    def _on_connect(self, client, userdata, flags, rc):
        """MQTT connection callback"""
        if rc == 0:
            self.is_connected = True
            logger.info(f"MQTT client {self.client_id} connected with result code {rc}")
            
            # Subscribe to topics
            for topic in self.subscriptions:
                self.client.subscribe(topic, qos=1)
                logger.info(f"Subscribed to topic: {topic}")
                
        else:
            logger.error(f"Failed to connect to MQTT broker, return code {rc}")
    
    def _on_disconnect(self, client, userdata, rc):
        """MQTT disconnection callback"""
        self.is_connected = False
        if rc != 0:
            logger.warning(f"Unexpected MQTT disconnection. Return code: {rc}")
        else:
            logger.info("MQTT client disconnected")
    
    def _on_subscribe(self, client, userdata, mid, granted_qos):
        """MQTT subscription callback"""
        logger.debug(f"Subscription confirmed for message ID {mid} with QoS {granted_qos}")
    
    def _on_publish(self, client, userdata, mid):
        """MQTT publish callback"""
        self.total_messages_published += 1
        logger.debug(f"Message {mid} published successfully")
    
    def _on_message(self, client, userdata, msg):
        """MQTT message callback"""
        try:
            self.total_messages_received += 1
            
            # Create message object
            mqtt_message = MQTTMessage(
                topic=msg.topic,
                payload=msg.payload.decode('utf-8'),
                timestamp=datetime.utcnow(),
                qos=msg.qos,
                retain=msg.retain
            )\n            \n            # Add to history\n            self.message_history.append(mqtt_message)\n            if len(self.message_history) > self.max_history:\n                self.message_history.pop(0)\n            \n            logger.info(f\"Received message on topic '{msg.topic}': {len(msg.payload)} bytes\")\n            \n            # Route message to handlers\n            self._route_message(mqtt_message)\n            \n        except Exception as e:\n            logger.error(f\"Error processing MQTT message: {e}\")\n    \n    def _route_message(self, message: MQTTMessage):\n        \"\"\"Route message to appropriate handlers based on topic\"\"\"\n        try:\n            # Parse topic to determine message type\n            topic_parts = message.topic.split('/')\n            \n            if len(topic_parts) >= 3:\n                category = topic_parts[1]  # emissions, verification, oracle, system\n                \n                # Route based on category\n                if category == \"emissions\":\n                    self._handle_emission_data(message)\n                elif category == \"verification\":\n                    self._handle_verification_request(message)\n                elif category == \"oracle\":\n                    self._handle_oracle_response(message)\n                elif category == \"system\":\n                    self._handle_system_message(message)\n                else:\n                    logger.warning(f\"Unknown message category: {category}\")\n            \n            # Call custom handlers\n            for topic_pattern, handlers in self.message_handlers.items():\n                if self._topic_matches(message.topic, topic_pattern):\n                    for handler in handlers:\n                        try:\n                            handler(message)\n                        except Exception as e:\n                            logger.error(f\"Error in message handler: {e}\")\n                            \n        except Exception as e:\n            logger.error(f\"Error routing message: {e}\")\n    \n    def _handle_emission_data(self, message: MQTTMessage):\n        \"\"\"Handle emission sensor data\"\"\"\n        try:\n            # Parse sensor data\n            sensor_data = json.loads(message.payload)\n            sensor_id = sensor_data.get('sensor_id')\n            co2_ppm = sensor_data.get('measurements', {}).get('co2_ppm')\n            \n            logger.info(f\"Emission data from sensor {sensor_id}: {co2_ppm} ppm CO2\")\n            \n            # Validate data quality\n            if self._validate_sensor_data(sensor_data):\n                # Forward to oracle for blockchain submission\n                self._forward_to_oracle(sensor_data)\n            else:\n                logger.warning(f\"Invalid sensor data from {sensor_id}, not forwarding\")\n                \n        except json.JSONDecodeError as e:\n            logger.error(f\"Invalid JSON in emission data: {e}\")\n        except Exception as e:\n            logger.error(f\"Error handling emission data: {e}\")\n    \n    def _handle_verification_request(self, message: MQTTMessage):\n        \"\"\"Handle verification requests\"\"\"\n        try:\n            verification_data = json.loads(message.payload)\n            logger.info(f\"Verification request: {verification_data.get('project_id')}\")\n            \n            # Forward to AI verification service\n            self.publish_message(\n                \"carbon-credits/ai-verification/request\",\n                message.payload,\n                qos=1\n            )\n            \n        except Exception as e:\n            logger.error(f\"Error handling verification request: {e}\")\n    \n    def _handle_oracle_response(self, message: MQTTMessage):\n        \"\"\"Handle oracle responses\"\"\"\n        try:\n            oracle_data = json.loads(message.payload)\n            logger.info(f\"Oracle response: {oracle_data.get('status')}\")\n            \n        except Exception as e:\n            logger.error(f\"Error handling oracle response: {e}\")\n    \n    def _handle_system_message(self, message: MQTTMessage):\n        \"\"\"Handle system messages\"\"\"\n        try:\n            system_data = json.loads(message.payload)\n            logger.info(f\"System message: {system_data.get('type')}\")\n            \n        except Exception as e:\n            logger.error(f\"Error handling system message: {e}\")\n    \n    def _validate_sensor_data(self, sensor_data: Dict) -> bool:\n        \"\"\"Validate sensor data quality and completeness\"\"\"\n        try:\n            # Check required fields\n            required_fields = ['sensor_id', 'timestamp', 'measurements', 'data_hash']\n            for field in required_fields:\n                if field not in sensor_data:\n                    logger.warning(f\"Missing required field: {field}\")\n                    return False\n            \n            # Check CO2 reading is reasonable (250-5000 ppm)\n            co2_ppm = sensor_data.get('measurements', {}).get('co2_ppm')\n            if not co2_ppm or co2_ppm < 250 or co2_ppm > 5000:\n                logger.warning(f\"CO2 reading out of range: {co2_ppm}\")\n                return False\n            \n            # Check data quality score\n            accuracy_score = sensor_data.get('data_quality', {}).get('accuracy_score', 0)\n            if accuracy_score < 0.8:  # Minimum 80% accuracy\n                logger.warning(f\"Data quality too low: {accuracy_score}\")\n                return False\n            \n            # Verify data hash\n            expected_hash = self._calculate_data_hash(sensor_data)\n            if sensor_data['data_hash'] != expected_hash:\n                logger.warning(\"Data hash verification failed\")\n                return False\n            \n            return True\n            \n        except Exception as e:\n            logger.error(f\"Error validating sensor data: {e}\")\n            return False\n    \n    def _calculate_data_hash(self, sensor_data: Dict) -> str:\n        \"\"\"Calculate expected data hash for verification\"\"\"\n        import hashlib\n        \n        # Create copy without hash field\n        data_copy = sensor_data.copy()\n        data_copy.pop('data_hash', None)\n        \n        # Calculate hash\n        data_string = json.dumps(data_copy, sort_keys=True)\n        return hashlib.sha256(data_string.encode()).hexdigest()\n    \n    def _forward_to_oracle(self, sensor_data: Dict):\n        \"\"\"Forward validated sensor data to blockchain oracle\"\"\"\n        try:\n            oracle_message = {\n                'type': 'emission_data',\n                'timestamp': datetime.utcnow().isoformat(),\n                'sensor_data': sensor_data,\n                'validation_status': 'passed'\n            }\n            \n            self.publish_message(\n                \"carbon-credits/oracle/emission-data\",\n                json.dumps(oracle_message),\n                qos=1\n            )\n            \n            logger.info(f\"Forwarded sensor data to oracle: {sensor_data['sensor_id']}\")\n            \n        except Exception as e:\n            logger.error(f\"Error forwarding to oracle: {e}\")\n    \n    def _topic_matches(self, topic: str, pattern: str) -> bool:\n        \"\"\"Check if topic matches pattern (supports + and # wildcards)\"\"\"\n        topic_parts = topic.split('/')\n        pattern_parts = pattern.split('/')\n        \n        if len(pattern_parts) > len(topic_parts):\n            return False\n        \n        for i, pattern_part in enumerate(pattern_parts):\n            if pattern_part == '#':\n                return True\n            elif pattern_part == '+':\n                continue\n            elif i >= len(topic_parts) or pattern_part != topic_parts[i]:\n                return False\n        \n        return len(pattern_parts) == len(topic_parts)\n    \n    def add_message_handler(self, topic_pattern: str, handler: Callable[[MQTTMessage], None]):\n        \"\"\"Add custom message handler for specific topic pattern\"\"\"\n        if topic_pattern not in self.message_handlers:\n            self.message_handlers[topic_pattern] = []\n        self.message_handlers[topic_pattern].append(handler)\n        logger.info(f\"Added message handler for topic pattern: {topic_pattern}\")\n    \n    def publish_message(self, topic: str, payload: str, qos: int = 0, retain: bool = False) -> bool:\n        \"\"\"Publish message to MQTT broker\"\"\"\n        if not self.is_connected:\n            logger.error(\"Not connected to MQTT broker\")\n            return False\n        \n        try:\n            result = self.client.publish(topic, payload, qos, retain)\n            if result.rc == mqtt.MQTT_ERR_SUCCESS:\n                logger.debug(f\"Published message to topic: {topic}\")\n                return True\n            else:\n                logger.error(f\"Failed to publish message: {result.rc}\")\n                return False\n        except Exception as e:\n            logger.error(f\"Error publishing message: {e}\")\n            return False\n    \n    def get_statistics(self) -> Dict:\n        \"\"\"Get client statistics\"\"\"\n        return {\n            'client_id': self.client_id,\n            'connected': self.is_connected,\n            'connection_attempts': self.connection_attempts,\n            'last_connection': self.last_connection_time.isoformat() if self.last_connection_time else None,\n            'messages_received': self.total_messages_received,\n            'messages_published': self.total_messages_published,\n            'message_history_size': len(self.message_history),\n            'subscribed_topics': self.subscriptions\n        }\n    \n    def disconnect(self):\n        \"\"\"Disconnect from MQTT broker\"\"\"\n        if self.client:\n            self.client.loop_stop()\n            self.client.disconnect()\n            logger.info(f\"MQTT client {self.client_id} disconnected\")\n\ndef main():\n    \"\"\"Main function for testing MQTT broker client\"\"\"\n    import os\n    from dotenv import load_dotenv\n    \n    # Load environment variables\n    load_dotenv()\n    \n    # MQTT broker configuration\n    broker_config = {\n        'host': os.getenv('MQTT_BROKER', 'localhost'),\n        'port': os.getenv('MQTT_PORT', '1883'),\n        'username': os.getenv('MQTT_USERNAME', ''),\n        'password': os.getenv('MQTT_PASSWORD', '')\n    }\n    \n    # Create MQTT client\n    client = MQTTBrokerClient('carbon-credits-broker', broker_config)\n    \n    # Add custom message handler example\n    def custom_handler(message: MQTTMessage):\n        logger.info(f\"Custom handler received message on {message.topic}\")\n    \n    client.add_message_handler('carbon-credits/+/+', custom_handler)\n    \n    # Connect and start processing\n    if client.connect():\n        logger.info(\"MQTT broker client started successfully\")\n        logger.info(\"Press Ctrl+C to stop\")\n        \n        try:\n            # Keep running\n            while True:\n                time.sleep(10)\n                \n                # Print statistics every 10 seconds\n                stats = client.get_statistics()\n                logger.info(f\"Statistics: {stats['messages_received']} received, \"\n                          f\"{stats['messages_published']} published\")\n                \n        except KeyboardInterrupt:\n            logger.info(\"Shutting down MQTT client...\")\n        finally:\n            client.disconnect()\n    else:\n        logger.error(\"Failed to start MQTT broker client\")\n\nif __name__ == \"__main__\":\n    main()"
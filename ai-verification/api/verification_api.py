#!/usr/bin/env python3
"""
AI Verification API Service
Flask API for carbon credit verification using ML models
Provides endpoints for real-time fraud detection and batch processing
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
import hashlib
from flask import Flask, request, jsonify
from flask_cors import CORS
import paho.mqtt.client as mqtt
from dotenv import load_dotenv
import threading
import time

# Import our fraud detection system
from models.fraud_detection import CarbonFraudDetector, VerificationResult

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global variables
fraud_detector = None
mqtt_client = None
verification_history = []
api_stats = {
    'total_verifications': 0,
    'legitimate_count': 0,
    'suspicious_count': 0,
    'fraudulent_count': 0,
    'avg_processing_time': 0,
    'start_time': datetime.utcnow().isoformat()
}

class VerificationAPI:
    """Main API class for verification service"""
    
    def __init__(self):
        """Initialize verification API"""
        global fraud_detector
        
        # Initialize fraud detection models
        logger.info("Initializing AI fraud detection models...")
        fraud_detector = CarbonFraudDetector(model_path='./models/')
        
        # Try to load pre-trained models, train if not available
        try:
            fraud_detector.load_models()
            logger.info("Pre-trained models loaded successfully")
        except Exception as e:
            logger.warning(f"Could not load pre-trained models: {e}")
            logger.info("Training new models...")
            fraud_detector.train_models()
            fraud_detector.save_models()
        
        # Initialize MQTT client for receiving sensor data
        self.setup_mqtt()
        
        logger.info("Verification API initialized successfully")
    
    def setup_mqtt(self):
        """Setup MQTT client for receiving sensor data"""
        global mqtt_client
        
        try:
            mqtt_config = {
                'host': os.getenv('MQTT_BROKER', 'localhost'),
                'port': int(os.getenv('MQTT_PORT', '1883')),
                'username': os.getenv('MQTT_USERNAME', ''),
                'password': os.getenv('MQTT_PASSWORD', '')
            }
            
            mqtt_client = mqtt.Client(client_id='ai_verification_service')
            
            if mqtt_config['username'] and mqtt_config['password']:
                mqtt_client.username_pw_set(mqtt_config['username'], mqtt_config['password'])
            
            # Set up callbacks
            mqtt_client.on_connect = self.on_mqtt_connect
            mqtt_client.on_message = self.on_mqtt_message
            
            # Connect to broker
            mqtt_client.connect(mqtt_config['host'], mqtt_config['port'], 60)
            mqtt_client.loop_start()
            
            logger.info("MQTT client connected for automatic verification")
            
        except Exception as e:
            logger.error(f"Failed to setup MQTT client: {e}")
    
    def on_mqtt_connect(self, client, userdata, flags, rc):
        """MQTT connection callback"""
        if rc == 0:
            # Subscribe to emission data and verification requests
            client.subscribe("carbon-credits/emissions/+")
            client.subscribe("carbon-credits/ai-verification/request")
            logger.info("Subscribed to MQTT topics for automatic verification")
        else:
            logger.error(f"Failed to connect to MQTT broker: {rc}")
    
    def on_mqtt_message(self, client, userdata, msg):
        """MQTT message callback for automatic verification"""
        try:
            topic = msg.topic
            payload = json.loads(msg.payload.decode('utf-8'))
            
            logger.info(f"Received MQTT message on topic: {topic}")
            
            if topic.startswith("carbon-credits/emissions/"):
                # Automatic verification of sensor data
                self.process_sensor_data(payload)
            elif topic == "carbon-credits/ai-verification/request":
                # Manual verification request
                self.process_verification_request(payload)
                
        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}")
    
    def process_sensor_data(self, sensor_data: Dict):
        """Process incoming sensor data for verification"""
        try:
            # Perform AI verification
            result = fraud_detector.verify_sensor_data(sensor_data)
            
            # Update statistics
            self.update_stats(result)
            
            # Store in history
            verification_record = {
                'sensor_id': sensor_data.get('sensor_id'),
                'timestamp': datetime.utcnow().isoformat(),
                'verification_result': result.__dict__,
                'sensor_data_hash': hashlib.sha256(json.dumps(sensor_data).encode()).hexdigest()[:16]
            }
            verification_history.append(verification_record)
            
            # Keep only last 1000 records
            if len(verification_history) > 1000:
                verification_history.pop(0)
            
            # Publish result to blockchain oracle if legitimate
            if result.score >= 90:  # High confidence threshold
                self.forward_to_oracle(sensor_data, result)
            elif result.score <= 60:  # Low confidence threshold
                logger.warning(f"Rejected sensor data from {sensor_data.get('sensor_id')}: Score {result.score}")
            else:
                logger.info(f"Flagged for human review: {sensor_data.get('sensor_id')}: Score {result.score}")
            
        except Exception as e:
            logger.error(f"Error processing sensor data: {e}")
    
    def process_verification_request(self, request_data: Dict):
        """Process manual verification request"""
        try:
            # Extract sensor data from request
            sensor_data = request_data.get('sensor_data', {})
            request_id = request_data.get('request_id')
            
            # Perform verification
            result = fraud_detector.verify_sensor_data(sensor_data)
            
            # Send result back via MQTT
            response = {
                'request_id': request_id,
                'verification_result': result.__dict__,
                'timestamp': datetime.utcnow().isoformat()
            }
            
            mqtt_client.publish(
                "carbon-credits/ai-verification/response",
                json.dumps(response),
                qos=1
            )
            
            logger.info(f"Processed verification request {request_id}: Score {result.score}")
            
        except Exception as e:
            logger.error(f"Error processing verification request: {e}")
    
    def forward_to_oracle(self, sensor_data: Dict, result: VerificationResult):
        """Forward verified data to blockchain oracle"""
        try:
            oracle_message = {
                'type': 'ai_verified_data',
                'sensor_data': sensor_data,
                'verification_score': result.score,
                'confidence': result.confidence,
                'anomaly_flags': result.anomaly_flags,
                'timestamp': datetime.utcnow().isoformat(),
                'ai_analysis_hash': hashlib.sha256(json.dumps(result.__dict__).encode()).hexdigest()
            }
            
            mqtt_client.publish(
                "carbon-credits/oracle/ai-verified",
                json.dumps(oracle_message),
                qos=1
            )
            
            logger.info(f"Forwarded verified data to oracle: {sensor_data.get('sensor_id')}")
            
        except Exception as e:
            logger.error(f"Error forwarding to oracle: {e}")
    
    def update_stats(self, result: VerificationResult):
        """Update API statistics"""
        global api_stats
        
        api_stats['total_verifications'] += 1
        
        if result.prediction == 'legitimate':
            api_stats['legitimate_count'] += 1
        elif result.prediction == 'suspicious':
            api_stats['suspicious_count'] += 1
        else:
            api_stats['fraudulent_count'] += 1

# Initialize API
verification_api = VerificationAPI()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'models_loaded': fraud_detector.is_trained if fraud_detector else False,
        'version': '1.0.0'
    })

@app.route('/verify', methods=['POST'])
def verify_sensor_data():
    """Main verification endpoint for sensor data"""
    try:
        start_time = time.time()
        
        # Get sensor data from request
        sensor_data = request.get_json()
        
        if not sensor_data:
            return jsonify({'error': 'No sensor data provided'}), 400
        
        # Validate required fields
        required_fields = ['sensor_id', 'timestamp', 'measurements']
        for field in required_fields:
            if field not in sensor_data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Perform AI verification
        result = fraud_detector.verify_sensor_data(sensor_data)
        
        # Calculate processing time
        processing_time = time.time() - start_time
        
        # Update statistics
        verification_api.update_stats(result)
        
        # Update average processing time
        total_verifications = api_stats['total_verifications']
        api_stats['avg_processing_time'] = (
            (api_stats['avg_processing_time'] * (total_verifications - 1) + processing_time) / total_verifications
        )
        
        # Prepare response
        response = {
            'verification_result': {
                'score': result.score,
                'prediction': result.prediction,
                'confidence': result.confidence,
                'anomaly_flags': result.anomaly_flags,
                'risk_factors': result.risk_factors,
                'timestamp': result.timestamp
            },
            'processing_time_ms': round(processing_time * 1000, 2),
            'sensor_id': sensor_data.get('sensor_id'),
            'api_version': '1.0.0'
        }
        
        # Add detailed model outputs if requested
        if request.args.get('detailed') == 'true':
            response['model_outputs'] = result.model_outputs
        
        logger.info(f"Verified sensor data: {sensor_data.get('sensor_id')} - Score: {result.score:.1f}")
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Error in verification endpoint: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/batch-verify', methods=['POST'])
def batch_verify():
    """Batch verification endpoint for multiple sensor readings"""
    try:
        start_time = time.time()
        
        # Get batch data from request
        batch_data = request.get_json()
        
        if not batch_data or 'sensor_data_list' not in batch_data:
            return jsonify({'error': 'No sensor data list provided'}), 400
        
        sensor_data_list = batch_data['sensor_data_list']
        
        if len(sensor_data_list) > 100:  # Limit batch size
            return jsonify({'error': 'Batch size too large (max 100)'}), 400
        
        # Process each sensor reading
        results = []
        for i, sensor_data in enumerate(sensor_data_list):
            try:
                result = fraud_detector.verify_sensor_data(sensor_data)
                verification_api.update_stats(result)
                
                results.append({
                    'index': i,
                    'sensor_id': sensor_data.get('sensor_id'),
                    'score': result.score,
                    'prediction': result.prediction,
                    'confidence': result.confidence,
                    'anomaly_flags': result.anomaly_flags
                })
                
            except Exception as e:
                logger.error(f"Error processing batch item {i}: {e}")
                results.append({
                    'index': i,
                    'sensor_id': sensor_data.get('sensor_id'),
                    'error': str(e)
                })
        
        processing_time = time.time() - start_time
        
        # Calculate batch statistics
        successful_verifications = [r for r in results if 'error' not in r]
        batch_stats = {
            'total_items': len(sensor_data_list),
            'successful': len(successful_verifications),
            'failed': len(results) - len(successful_verifications),
            'avg_score': sum(r['score'] for r in successful_verifications) / len(successful_verifications) if successful_verifications else 0,
            'processing_time_ms': round(processing_time * 1000, 2)
        }
        
        return jsonify({
            'batch_results': results,
            'batch_statistics': batch_stats,
            'timestamp': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error in batch verification endpoint: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/stats', methods=['GET'])
def get_statistics():
    """Get API usage statistics"""
    try:
        # Add uptime calculation
        start_time = datetime.fromisoformat(api_stats['start_time'])
        uptime_seconds = (datetime.utcnow() - start_time).total_seconds()
        
        stats_response = api_stats.copy()
        stats_response.update({
            'uptime_seconds': round(uptime_seconds),
            'uptime_hours': round(uptime_seconds / 3600, 2),
            'verification_rate_per_hour': round(api_stats['total_verifications'] / max(uptime_seconds / 3600, 0.001), 2),
            'fraud_detection_rate': round(api_stats['fraudulent_count'] / max(api_stats['total_verifications'], 1) * 100, 2),
            'model_performance': {
                'total_models': len(fraud_detector.models) if fraud_detector else 0,
                'feature_count': len(fraud_detector._get_default_features()) if fraud_detector else 0,
                'is_trained': fraud_detector.is_trained if fraud_detector else False
            }
        })
        
        return jsonify(stats_response)
        
    except Exception as e:
        logger.error(f"Error getting statistics: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/history', methods=['GET'])
def get_verification_history():
    """Get recent verification history"""
    try:
        # Get query parameters
        limit = min(int(request.args.get('limit', 50)), 1000)
        sensor_id = request.args.get('sensor_id')
        
        # Filter history
        filtered_history = verification_history
        if sensor_id:
            filtered_history = [h for h in verification_history if h['sensor_id'] == sensor_id]
        
        # Get recent entries
        recent_history = filtered_history[-limit:]
        
        return jsonify({
            'history': recent_history,
            'total_records': len(verification_history),
            'filtered_records': len(filtered_history),
            'returned_records': len(recent_history),
            'timestamp': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting verification history: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/model-info', methods=['GET'])
def get_model_info():
    """Get information about loaded AI models"""
    try:
        if not fraud_detector:
            return jsonify({'error': 'Models not initialized'}), 500
        
        model_info = {
            'models_loaded': list(fraud_detector.models.keys()) if fraud_detector.models else [],
            'is_trained': fraud_detector.is_trained,
            'feature_importance': fraud_detector.feature_importance,
            'thresholds': fraud_detector.thresholds,
            'model_versions': {
                'fraud_detector': '1.0.0',
                'tensorflow': tf.__version__,
                'sklearn': '1.7.1',
                'xgboost': xgb.__version__
            }
        }
        
        return jsonify(model_info)
        
    except Exception as e:
        logger.error(f"Error getting model info: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/retrain', methods=['POST'])
def retrain_models():
    """Retrain models with new data (admin endpoint)"""
    try:
        # This would typically require authentication
        # For demo purposes, we'll allow it
        
        request_data = request.get_json()
        sample_size = request_data.get('sample_size', 10000) if request_data else 10000
        
        logger.info(f"Starting model retraining with {sample_size} samples...")
        
        # Retrain models
        fraud_detector.train_models()
        fraud_detector.save_models()
        
        logger.info("Model retraining completed successfully")
        
        return jsonify({
            'message': 'Models retrained successfully',
            'sample_size': sample_size,
            'timestamp': datetime.utcnow().isoformat(),
            'models_updated': list(fraud_detector.models.keys())
        })
        
    except Exception as e:
        logger.error(f"Error retraining models: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Import required modules
    import tensorflow as tf
    import xgboost as xgb
    
    logger.info("Starting AI Verification API Service...")
    logger.info(f"TensorFlow version: {tf.__version__}")
    logger.info(f"XGBoost version: {xgb.__version__}")
    
    # Get configuration from environment
    host = os.getenv('AI_API_HOST', '0.0.0.0')
    port = int(os.getenv('AI_API_PORT', 5000))
    debug = os.getenv('NODE_ENV', 'development') == 'development'
    
    logger.info(f"API server starting on {host}:{port}")
    logger.info("Available endpoints:")
    logger.info("  POST /verify - Verify single sensor reading")
    logger.info("  POST /batch-verify - Verify multiple sensor readings")
    logger.info("  GET  /stats - Get API statistics")
    logger.info("  GET  /history - Get verification history")
    logger.info("  GET  /model-info - Get AI model information")
    logger.info("  GET  /health - Health check")
    logger.info("  POST /retrain - Retrain models (admin)")
    
    # Start the Flask app
    app.run(host=host, port=port, debug=debug, threaded=True)
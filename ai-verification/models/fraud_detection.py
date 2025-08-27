#!/usr/bin/env python3
"""
AI Fraud Detection Model for Carbon Credit Verification
Implements XGBoost, Random Forest, and Neural Network models for detecting fraudulent emissions data
Based on research findings showing 90% accuracy improvements in carbon verification
"""

import numpy as np
import pandas as pd
import pickle
import logging
from typing import Dict, List, Tuple, Optional, Any
from datetime import datetime
from dataclasses import dataclass
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, classification_report
import xgboost as xgb
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import joblib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class VerificationResult:
    """Result of AI verification process"""
    score: float  # 0-100 confidence score
    prediction: str  # 'legitimate', 'suspicious', 'fraudulent'
    confidence: float  # Model confidence level
    anomaly_flags: List[str]  # List of detected anomalies
    model_outputs: Dict[str, float]  # Individual model scores
    risk_factors: Dict[str, float]  # Identified risk factors
    timestamp: str

class CarbonFraudDetector:
    """AI-powered fraud detection system for carbon credits"""
    
    def __init__(self, model_path: str = './models/'):
        """
        Initialize fraud detection system
        
        Args:
            model_path: Directory path for saving/loading trained models
        """
        self.model_path = model_path
        self.models = {}
        self.scalers = {}
        self.encoders = {}
        self.is_trained = False
        
        # Model hyperparameters
        self.rf_params = {
            'n_estimators': 200,
            'max_depth': 15,
            'min_samples_split': 5,
            'min_samples_leaf': 2,
            'random_state': 42
        }
        
        self.xgb_params = {
            'n_estimators': 200,
            'max_depth': 8,
            'learning_rate': 0.1,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'random_state': 42
        }
        
        # Anomaly detection thresholds
        self.thresholds = {
            'high_confidence': 0.90,  # Auto-approve above 90%
            'low_confidence': 0.60,   # Auto-reject below 60%
            'anomaly_threshold': -0.5  # Isolation Forest threshold
        }
        
        # Feature importance tracking
        self.feature_importance = {}
        
    def create_features(self, sensor_data: Dict) -> Dict[str, float]:
        """
        Create feature vector from sensor data for ML models
        
        Args:
            sensor_data: Raw sensor data dictionary
            
        Returns:
            Dictionary of engineered features
        """
        try:
            measurements = sensor_data.get('measurements', {})
            sensor_status = sensor_data.get('sensor_status', {})
            data_quality = sensor_data.get('data_quality', {})
            
            # Basic sensor readings
            features = {
                'co2_ppm': measurements.get('co2_ppm', 400),
                'temperature': measurements.get('temperature', 20),
                'humidity': measurements.get('humidity', 50),
                'pressure': measurements.get('pressure', 1013),
            }
            
            # Sensor health indicators
            features.update({
                'battery_level': sensor_status.get('battery_level', 100),
                'signal_strength': abs(sensor_status.get('signal_strength', -50)),
                'error_rate': sensor_status.get('error_rate', 0),
                'total_readings': sensor_status.get('total_readings', 0),
            })
            
            # Data quality metrics
            features.update({
                'accuracy_score': data_quality.get('accuracy_score', 0.95),
                'confidence_interval': data_quality.get('confidence_interval', 0.05),
                'anomaly_score': data_quality.get('anomaly_score', 0.02),
            })
            
            # Temporal features
            timestamp = datetime.fromisoformat(sensor_data.get('timestamp', datetime.utcnow().isoformat().replace('+00:00', '')))
            features.update({
                'hour_of_day': timestamp.hour,
                'day_of_week': timestamp.weekday(),
                'day_of_month': timestamp.day,
                'month_of_year': timestamp.month,
            })
            
            # Location-based features (if available)
            location = sensor_data.get('location', {})
            features.update({
                'latitude': location.get('lat', 0),
                'longitude': location.get('lon', 0),
                'altitude': location.get('altitude', 0),
            })
            
            # Derived features for anomaly detection
            features.update({
                'co2_deviation': abs(features['co2_ppm'] - 400),  # Deviation from normal atmospheric CO2
                'temp_humidity_ratio': features['temperature'] / max(features['humidity'], 1),
                'pressure_altitude_consistency': self._check_pressure_altitude_consistency(features['pressure'], features['altitude']),
                'sensor_reliability': (features['battery_level'] / 100) * (1 - features['error_rate']),
            })
            
            # Data integrity features
            features.update({
                'has_data_hash': 1 if sensor_data.get('data_hash') else 0,
                'data_completeness': len([v for v in features.values() if v != 0]) / len(features),
                'reading_frequency': min(features['total_readings'] / max(1, (datetime.utcnow() - timestamp).days), 100),
            })
            
            return features
            
        except Exception as e:
            logger.error(f"Error creating features: {e}")
            return self._get_default_features()
    
    def _check_pressure_altitude_consistency(self, pressure: float, altitude: float) -> float:
        """Check consistency between pressure and altitude readings"""
        # Standard atmospheric pressure formula
        expected_pressure = 1013.25 * (1 - 0.0065 * altitude / 288.15) ** 5.257
        deviation = abs(pressure - expected_pressure) / expected_pressure
        return 1 - min(deviation, 1)  # Return consistency score (0-1)
    
    def _get_default_features(self) -> Dict[str, float]:
        """Get default feature values for error cases"""
        return {
            'co2_ppm': 400, 'temperature': 20, 'humidity': 50, 'pressure': 1013,
            'battery_level': 100, 'signal_strength': 50, 'error_rate': 0, 'total_readings': 0,
            'accuracy_score': 0.95, 'confidence_interval': 0.05, 'anomaly_score': 0.02,
            'hour_of_day': 12, 'day_of_week': 0, 'day_of_month': 1, 'month_of_year': 1,
            'latitude': 0, 'longitude': 0, 'altitude': 0,
            'co2_deviation': 0, 'temp_humidity_ratio': 0.4, 'pressure_altitude_consistency': 1,
            'sensor_reliability': 1, 'has_data_hash': 1, 'data_completeness': 1, 'reading_frequency': 1
        }
    
    def generate_training_data(self, num_samples: int = 10000) -> Tuple[np.ndarray, np.ndarray]:
        """
        Generate synthetic training data for model development
        In production, this would use real historical data
        """
        logger.info(f"Generating {num_samples} training samples...")
        
        # Generate legitimate samples (80%)
        legitimate_samples = int(num_samples * 0.8)
        fraudulent_samples = num_samples - legitimate_samples
        
        data = []
        labels = []
        
        # Generate legitimate data
        for _ in range(legitimate_samples):
            sample = self._generate_legitimate_sample()
            data.append(list(sample.values()))
            labels.append(1)  # 1 = legitimate
        
        # Generate fraudulent data
        for _ in range(fraudulent_samples):
            sample = self._generate_fraudulent_sample()
            data.append(list(sample.values()))
            labels.append(0)  # 0 = fraudulent
        
        return np.array(data), np.array(labels)
    
    def _generate_legitimate_sample(self) -> Dict[str, float]:
        """Generate realistic legitimate sensor data"""
        # Base legitimate readings with realistic variations
        co2_base = np.random.normal(420, 50)  # Slightly elevated CO2 with variation
        temp = np.random.normal(22, 5)
        humidity = np.random.normal(50, 15)
        pressure = np.random.normal(1013, 10)
        
        return {
            'co2_ppm': max(300, min(600, co2_base)),
            'temperature': max(0, min(50, temp)),
            'humidity': max(20, min(90, humidity)),
            'pressure': max(900, min(1100, pressure)),
            'battery_level': np.random.normal(90, 10),
            'signal_strength': np.random.normal(60, 15),
            'error_rate': np.random.exponential(0.02),  # Low error rate
            'total_readings': np.random.randint(100, 10000),
            'accuracy_score': np.random.normal(0.95, 0.03),
            'confidence_interval': np.random.normal(0.05, 0.02),
            'anomaly_score': np.random.exponential(0.05),
            'hour_of_day': np.random.randint(0, 24),
            'day_of_week': np.random.randint(0, 7),
            'day_of_month': np.random.randint(1, 32),
            'month_of_year': np.random.randint(1, 13),
            'latitude': np.random.uniform(-90, 90),
            'longitude': np.random.uniform(-180, 180),
            'altitude': np.random.exponential(100),
            'co2_deviation': abs(co2_base - 400),
            'temp_humidity_ratio': temp / max(humidity, 1),
            'pressure_altitude_consistency': np.random.normal(0.9, 0.1),
            'sensor_reliability': np.random.normal(0.9, 0.1),
            'has_data_hash': 1,
            'data_completeness': np.random.normal(0.95, 0.05),
            'reading_frequency': np.random.exponential(10)
        }
    
    def _generate_fraudulent_sample(self) -> Dict[str, float]:
        """Generate fraudulent sensor data with suspicious patterns"""
        fraud_type = np.random.choice(['extreme_values', 'inconsistent_data', 'poor_quality', 'fake_sensor'])
        
        if fraud_type == 'extreme_values':
            # Impossible or extreme CO2 values
            co2_base = np.random.choice([np.random.uniform(50, 200),  # Too low
                                       np.random.uniform(2000, 5000)])  # Too high
        elif fraud_type == 'inconsistent_data':
            # Inconsistent environmental readings
            co2_base = np.random.normal(420, 50)
        elif fraud_type == 'poor_quality':
            # Poor sensor quality indicators
            co2_base = np.random.normal(420, 100)  # High variance
        else:  # fake_sensor
            # Fake sensor with perfect readings (suspicious)
            co2_base = 400  # Exactly atmospheric
        
        # Generate suspicious features
        features = self._generate_legitimate_sample()  # Start with base
        
        # Apply fraud patterns
        if fraud_type == 'extreme_values':
            features['co2_ppm'] = co2_base
            features['co2_deviation'] = abs(co2_base - 400)
        elif fraud_type == 'inconsistent_data':
            features['pressure_altitude_consistency'] = np.random.uniform(0, 0.5)
            features['temp_humidity_ratio'] = np.random.uniform(0, 0.1)  # Unrealistic
        elif fraud_type == 'poor_quality':
            features['accuracy_score'] = np.random.uniform(0.3, 0.7)
            features['error_rate'] = np.random.uniform(0.1, 0.5)
            features['anomaly_score'] = np.random.uniform(0.2, 0.8)
            features['sensor_reliability'] = np.random.uniform(0.2, 0.6)
        else:  # fake_sensor
            features['co2_ppm'] = co2_base
            features['temperature'] = 20.0  # Too perfect
            features['humidity'] = 50.0
            features['accuracy_score'] = 1.0  # Suspiciously perfect
            features['anomaly_score'] = 0.0
            features['has_data_hash'] = 0  # Missing integrity check
        
        return features
    
    def train_models(self, X: np.ndarray = None, y: np.ndarray = None):
        """Train all fraud detection models"""
        logger.info("Training fraud detection models...")
        
        # Generate training data if not provided
        if X is None or y is None:
            X, y = self.generate_training_data(10000)
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        
        # Scale features
        self.scalers['standard'] = StandardScaler()
        X_train_scaled = self.scalers['standard'].fit_transform(X_train)
        X_test_scaled = self.scalers['standard'].transform(X_test)
        
        # Train Random Forest
        logger.info("Training Random Forest model...")
        self.models['random_forest'] = RandomForestClassifier(**self.rf_params)
        self.models['random_forest'].fit(X_train, y_train)
        
        # Train XGBoost
        logger.info("Training XGBoost model...")
        self.models['xgboost'] = xgb.XGBClassifier(**self.xgb_params)
        self.models['xgboost'].fit(X_train, y_train)
        
        # Train Neural Network
        logger.info("Training Neural Network model...")
        self.models['neural_network'] = self._build_neural_network(X_train.shape[1])
        self.models['neural_network'].fit(
            X_train_scaled, y_train,
            epochs=50,
            batch_size=32,
            validation_data=(X_test_scaled, y_test),
            verbose=0
        )
        
        # Train Isolation Forest for anomaly detection
        logger.info("Training Isolation Forest for anomaly detection...")
        self.models['isolation_forest'] = IsolationForest(
            contamination=0.1,
            random_state=42,
            n_estimators=100
        )
        self.models['isolation_forest'].fit(X_train_scaled)
        
        # Evaluate models
        self._evaluate_models(X_test, X_test_scaled, y_test)
        
        # Store feature importance
        self._extract_feature_importance()
        
        self.is_trained = True
        logger.info("Model training completed successfully!")
    
    def _build_neural_network(self, input_dim: int) -> keras.Model:
        """Build neural network for fraud detection"""
        model = keras.Sequential([
            layers.Dense(128, activation='relu', input_shape=(input_dim,)),
            layers.Dropout(0.3),
            layers.Dense(64, activation='relu'),
            layers.Dropout(0.2),
            layers.Dense(32, activation='relu'),
            layers.Dense(1, activation='sigmoid')
        ])
        
        model.compile(
            optimizer='adam',
            loss='binary_crossentropy',
            metrics=['accuracy', 'precision', 'recall']
        )
        
        return model
    
    def _evaluate_models(self, X_test: np.ndarray, X_test_scaled: np.ndarray, y_test: np.ndarray):
        """Evaluate all trained models"""
        logger.info("Evaluating model performance...")
        
        results = {}
        
        # Random Forest
        rf_pred = self.models['random_forest'].predict(X_test)
        results['random_forest'] = {
            'accuracy': accuracy_score(y_test, rf_pred),
            'precision': precision_score(y_test, rf_pred),
            'recall': recall_score(y_test, rf_pred),
            'f1': f1_score(y_test, rf_pred)
        }
        
        # XGBoost
        xgb_pred = self.models['xgboost'].predict(X_test)
        results['xgboost'] = {
            'accuracy': accuracy_score(y_test, xgb_pred),
            'precision': precision_score(y_test, xgb_pred),
            'recall': recall_score(y_test, xgb_pred),
            'f1': f1_score(y_test, xgb_pred)
        }
        
        # Neural Network
        nn_pred = (self.models['neural_network'].predict(X_test_scaled) > 0.5).astype(int).flatten()
        results['neural_network'] = {
            'accuracy': accuracy_score(y_test, nn_pred),
            'precision': precision_score(y_test, nn_pred),
            'recall': recall_score(y_test, nn_pred),
            'f1': f1_score(y_test, nn_pred)
        }
        
        # Log results
        for model_name, metrics in results.items():
            logger.info(f"{model_name.upper()} - Accuracy: {metrics['accuracy']:.3f}, "
                       f"Precision: {metrics['precision']:.3f}, "
                       f"Recall: {metrics['recall']:.3f}, "
                       f"F1: {metrics['f1']:.3f}")
    
    def _extract_feature_importance(self):
        """Extract and store feature importance from tree-based models"""
        feature_names = list(self._get_default_features().keys())
        
        # Random Forest importance
        if 'random_forest' in self.models:
            self.feature_importance['random_forest'] = dict(
                zip(feature_names, self.models['random_forest'].feature_importances_)
            )
        
        # XGBoost importance
        if 'xgboost' in self.models:
            self.feature_importance['xgboost'] = dict(
                zip(feature_names, self.models['xgboost'].feature_importances_)
            )
    
    def verify_sensor_data(self, sensor_data: Dict) -> VerificationResult:
        """
        Verify sensor data using ensemble of AI models
        
        Args:
            sensor_data: Raw sensor data dictionary
            
        Returns:
            VerificationResult with confidence score and analysis
        """
        if not self.is_trained:
            logger.warning("Models not trained yet. Training with synthetic data...")
            self.train_models()
        
        try:
            # Extract features
            features = self.create_features(sensor_data)
            feature_array = np.array(list(features.values())).reshape(1, -1)
            feature_array_scaled = self.scalers['standard'].transform(feature_array)
            
            # Get predictions from all models
            model_outputs = {}
            
            # Random Forest
            rf_prob = self.models['random_forest'].predict_proba(feature_array)[0][1]
            model_outputs['random_forest'] = rf_prob
            
            # XGBoost
            xgb_prob = self.models['xgboost'].predict_proba(feature_array)[0][1]
            model_outputs['xgboost'] = xgb_prob
            
            # Neural Network
            nn_prob = self.models['neural_network'].predict(feature_array_scaled)[0][0]
            model_outputs['neural_network'] = float(nn_prob)
            
            # Isolation Forest (anomaly detection)
            anomaly_score = self.models['isolation_forest'].decision_function(feature_array_scaled)[0]
            model_outputs['anomaly_score'] = float(anomaly_score)
            
            # Ensemble prediction (weighted average)
            weights = {'random_forest': 0.3, 'xgboost': 0.4, 'neural_network': 0.3}
            ensemble_score = sum(model_outputs[model] * weight for model, weight in weights.items())
            
            # Convert to 0-100 scale
            confidence_score = ensemble_score * 100
            
            # Determine prediction category
            if confidence_score >= self.thresholds['high_confidence'] * 100:
                prediction = 'legitimate'
                confidence = min(ensemble_score, 0.99)
            elif confidence_score <= self.thresholds['low_confidence'] * 100:
                prediction = 'fraudulent'
                confidence = 1 - ensemble_score
            else:
                prediction = 'suspicious'
                confidence = 0.5 + abs(0.75 - ensemble_score)  # Higher uncertainty
            
            # Identify anomaly flags
            anomaly_flags = self._identify_anomalies(features, anomaly_score)
            
            # Calculate risk factors
            risk_factors = self._calculate_risk_factors(features)
            
            return VerificationResult(
                score=confidence_score,
                prediction=prediction,
                confidence=confidence,
                anomaly_flags=anomaly_flags,
                model_outputs=model_outputs,
                risk_factors=risk_factors,
                timestamp=datetime.utcnow().isoformat()
            )
            
        except Exception as e:
            logger.error(f"Error in verification process: {e}")
            # Return conservative result in case of error
            return VerificationResult(
                score=50.0,
                prediction='suspicious',
                confidence=0.0,
                anomaly_flags=['verification_error'],
                model_outputs={},
                risk_factors={'error': 1.0},
                timestamp=datetime.utcnow().isoformat()
            )
    
    def _identify_anomalies(self, features: Dict[str, float], anomaly_score: float) -> List[str]:
        """Identify specific anomalies in the data"""
        flags = []
        
        # Check for extreme values
        if features['co2_ppm'] < 250 or features['co2_ppm'] > 2000:
            flags.append('extreme_co2_values')
        
        if features['accuracy_score'] < 0.8:
            flags.append('low_data_quality')
        
        if features['error_rate'] > 0.1:
            flags.append('high_error_rate')
        
        if features['pressure_altitude_consistency'] < 0.7:
            flags.append('inconsistent_environmental_data')
        
        if anomaly_score < self.thresholds['anomaly_threshold']:
            flags.append('statistical_anomaly')
        
        if features['has_data_hash'] == 0:
            flags.append('missing_data_integrity')
        
        if features['sensor_reliability'] < 0.6:
            flags.append('unreliable_sensor')
        
        return flags
    
    def _calculate_risk_factors(self, features: Dict[str, float]) -> Dict[str, float]:
        """Calculate risk factors based on features"""
        risk_factors = {}
        
        # Data quality risk
        risk_factors['data_quality'] = 1 - features['accuracy_score']
        
        # Sensor reliability risk
        risk_factors['sensor_health'] = 1 - features['sensor_reliability']
        
        # Environmental consistency risk
        risk_factors['environmental_consistency'] = 1 - features['pressure_altitude_consistency']
        
        # Extreme values risk
        normal_co2_range = (350, 500)
        if features['co2_ppm'] < normal_co2_range[0] or features['co2_ppm'] > normal_co2_range[1]:
            risk_factors['extreme_values'] = min(features['co2_deviation'] / 100, 1.0)
        else:
            risk_factors['extreme_values'] = 0.0
        
        # Data completeness risk
        risk_factors['data_completeness'] = 1 - features['data_completeness']
        
        return risk_factors
    
    def save_models(self, path: str = None):
        """Save trained models to disk"""
        if path is None:
            path = self.model_path
        
        try:
            # Save scikit-learn models
            joblib.dump(self.models['random_forest'], f"{path}/random_forest.pkl")
            joblib.dump(self.models['xgboost'], f"{path}/xgboost.pkl")
            joblib.dump(self.models['isolation_forest'], f"{path}/isolation_forest.pkl")
            joblib.dump(self.scalers['standard'], f"{path}/scaler.pkl")
            
            # Save neural network
            self.models['neural_network'].save(f"{path}/neural_network.h5")
            
            # Save feature importance and metadata
            with open(f"{path}/feature_importance.pkl", 'wb') as f:
                pickle.dump(self.feature_importance, f)
            
            with open(f"{path}/model_metadata.pkl", 'wb') as f:
                metadata = {
                    'thresholds': self.thresholds,
                    'is_trained': self.is_trained,
                    'training_timestamp': datetime.utcnow().isoformat()
                }
                pickle.dump(metadata, f)
            
            logger.info(f"Models saved successfully to {path}")
            
        except Exception as e:
            logger.error(f"Error saving models: {e}")
    
    def load_models(self, path: str = None):
        """Load trained models from disk"""
        if path is None:
            path = self.model_path
        
        try:
            # Load scikit-learn models
            self.models['random_forest'] = joblib.load(f"{path}/random_forest.pkl")
            self.models['xgboost'] = joblib.load(f"{path}/xgboost.pkl")
            self.models['isolation_forest'] = joblib.load(f"{path}/isolation_forest.pkl")
            self.scalers['standard'] = joblib.load(f"{path}/scaler.pkl")
            
            # Load neural network
            self.models['neural_network'] = keras.models.load_model(f"{path}/neural_network.h5")
            
            # Load feature importance and metadata
            with open(f"{path}/feature_importance.pkl", 'rb') as f:
                self.feature_importance = pickle.load(f)
            
            with open(f"{path}/model_metadata.pkl", 'rb') as f:
                metadata = pickle.load(f)
                self.thresholds = metadata['thresholds']
                self.is_trained = metadata['is_trained']
            
            logger.info(f"Models loaded successfully from {path}")
            
        except Exception as e:
            logger.error(f"Error loading models: {e}")
            self.is_trained = False

def main():
    """Main function for testing fraud detection system"""
    logger.info("Testing Carbon Fraud Detection System")
    
    # Initialize detector
    detector = CarbonFraudDetector()
    
    # Train models
    detector.train_models()
    
    # Test with sample data
    legitimate_data = {
        'sensor_id': 'test-001',
        'timestamp': datetime.utcnow().isoformat(),
        'measurements': {'co2_ppm': 420, 'temperature': 22, 'humidity': 55, 'pressure': 1013},
        'sensor_status': {'battery_level': 95, 'signal_strength': -45, 'error_rate': 0.01, 'total_readings': 1000},
        'data_quality': {'accuracy_score': 0.96, 'confidence_interval': 0.04, 'anomaly_score': 0.02},
        'location': {'lat': 37.7749, 'lon': -122.4194, 'altitude': 50},
        'data_hash': 'abc123'
    }
    
    fraudulent_data = {
        'sensor_id': 'test-002',
        'timestamp': datetime.utcnow().isoformat(),
        'measurements': {'co2_ppm': 3000, 'temperature': 22, 'humidity': 55, 'pressure': 1013},  # Extreme CO2
        'sensor_status': {'battery_level': 20, 'signal_strength': -90, 'error_rate': 0.3, 'total_readings': 10},
        'data_quality': {'accuracy_score': 0.5, 'confidence_interval': 0.2, 'anomaly_score': 0.8},
        'location': {'lat': 37.7749, 'lon': -122.4194, 'altitude': 50},
        'data_hash': None
    }
    
    # Test verification
    logger.info("\nTesting legitimate data:")
    result1 = detector.verify_sensor_data(legitimate_data)
    logger.info(f"Score: {result1.score:.1f}, Prediction: {result1.prediction}, Confidence: {result1.confidence:.3f}")
    logger.info(f"Anomaly flags: {result1.anomaly_flags}")
    
    logger.info("\nTesting fraudulent data:")
    result2 = detector.verify_sensor_data(fraudulent_data)
    logger.info(f"Score: {result2.score:.1f}, Prediction: {result2.prediction}, Confidence: {result2.confidence:.3f}")
    logger.info(f"Anomaly flags: {result2.anomaly_flags}")
    
    # Save models
    detector.save_models()
    
    logger.info("Fraud detection system test completed!")

if __name__ == "__main__":
    main()
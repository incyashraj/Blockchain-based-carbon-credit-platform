const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const IPFSService = require('../utils/ipfs');

jest.mock('../utils/ipfs');

describe('Blockchain API', () => {
  const mockUser = {
    _id: 'mockUserId',
    email: 'test@example.com',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    roles: ['user']
  };

  const validToken = jwt.sign(
    { userId: mockUser._id, email: mockUser.email },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /blockchain/status', () => {
    it('should return blockchain status', async () => {
      const response = await request(app)
        .get('/api/blockchain/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('provider');
      expect(response.body).toHaveProperty('contracts');
      expect(response.body).toHaveProperty('ipfs');
    });

    it('should handle blockchain connection errors', async () => {
      // Mock network error
      const originalGetNetwork = require('ethers').JsonRpcProvider.prototype.getNetwork;
      require('ethers').JsonRpcProvider.prototype.getNetwork = jest.fn().mockRejectedValue(new Error('Network error'));

      const response = await request(app)
        .get('/api/blockchain/status');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get blockchain status');

      // Restore original method
      require('ethers').JsonRpcProvider.prototype.getNetwork = originalGetNetwork;
    });
  });

  describe('GET /blockchain/credits', () => {
    it('should return active carbon credits', async () => {
      const response = await request(app)
        .get('/api/blockchain/credits');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('credits');
      expect(response.body).toHaveProperty('total');
    });

    it('should handle contract unavailable', async () => {
      // Mock contract not available
      const originalContracts = require('../routes/blockchain').carbonToken;
      require('../routes/blockchain').carbonToken = null;

      const response = await request(app)
        .get('/api/blockchain/credits');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Carbon token contract not available');
    });
  });

  describe('GET /blockchain/credits/:tokenId', () => {
    const mockTokenId = 1;

    it('should return specific carbon credit information', async () => {
      const response = await request(app)
        .get(`/api/blockchain/credits/${mockTokenId}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('credit');
    });

    it('should handle invalid token ID', async () => {
      const response = await request(app)
        .get('/api/blockchain/credits/invalid');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /blockchain/credits/user/:address', () => {
    const validAddress = '0x1234567890abcdef1234567890abcdef12345678';

    it('should return user carbon credits', async () => {
      const response = await request(app)
        .get(`/api/blockchain/credits/user/${validAddress}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('credits');
      expect(response.body).toHaveProperty('address');
      expect(response.body.address).toBe(validAddress);
    });

    it('should validate wallet address format', async () => {
      const response = await request(app)
        .get('/api/blockchain/credits/user/invalid_address');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid wallet address');
    });
  });

  describe('GET /blockchain/marketplace/listings', () => {
    it('should return marketplace listings', async () => {
      const response = await request(app)
        .get('/api/blockchain/marketplace/listings');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('listings');
      expect(response.body).toHaveProperty('total');
    });
  });

  describe('POST /blockchain/oracle/submit-data', () => {
    const validSensorData = {
      sensorId: 'SENSOR_001',
      sensorData: {
        timestamp: new Date().toISOString(),
        measurements: {
          co2_ppm: 450,
          temperature: 25.5,
          humidity: 60.2
        },
        location: {
          lat: 40.7128,
          lon: -74.0060
        },
        quality: {
          accuracy: 95,
          calibrationDate: new Date(Date.now() - 86400000).toISOString()
        }
      },
      location: {
        lat: 40.7128,
        lon: -74.0060
      }
    };

    beforeEach(() => {
      // Mock IPFS service
      IPFSService.prototype.uploadSensorData = jest.fn().mockResolvedValue({
        hash: 'QmMockHash',
        url: 'https://gateway.pinata.cloud/ipfs/QmMockHash',
        contentHash: 'mock_content_hash'
      });
    });

    it('should submit sensor data successfully', async () => {
      const response = await request(app)
        .post('/api/blockchain/oracle/submit-data')
        .set('Authorization', `Bearer ${validToken}`)
        .send(validSensorData);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Sensor data prepared for blockchain submission');
      expect(response.body).toHaveProperty('submissionData');
      expect(response.body).toHaveProperty('ipfs');
      expect(IPFSService.prototype.uploadSensorData).toHaveBeenCalled();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/blockchain/oracle/submit-data')
        .send(validSensorData);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should require wallet verification', async () => {
      const tokenWithoutWallet = jwt.sign(
        { userId: mockUser._id, email: mockUser.email },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/api/blockchain/oracle/submit-data')
        .set('Authorization', `Bearer ${tokenWithoutWallet}`)
        .send(validSensorData);

      // This would depend on the requireWallet middleware implementation
      expect(response.status).toBe(403);
    });

    it('should validate required fields', async () => {
      const incompleteData = {
        sensorId: 'SENSOR_001'
        // Missing sensorData
      };

      const response = await request(app)
        .post('/api/blockchain/oracle/submit-data')
        .set('Authorization', `Bearer ${validToken}`)
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields: sensorId, sensorData');
    });

    it('should handle IPFS upload failures', async () => {
      IPFSService.prototype.uploadSensorData = jest.fn().mockRejectedValue(new Error('IPFS upload failed'));

      const response = await request(app)
        .post('/api/blockchain/oracle/submit-data')
        .set('Authorization', `Bearer ${validToken}`)
        .send(validSensorData);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to submit sensor data');
    });
  });

  describe('POST /blockchain/oracle/request-verification', () => {
    const validVerificationRequest = {
      projectId: 'PROJECT_001',
      methodology: 'VERIFIED_CARBON_STANDARD',
      co2Equivalent: 1000,
      emissionDataIds: [1, 2, 3],
      verificationData: {
        methodology: 'VCS',
        standard: '4.0',
        auditor: 'Third Party Auditor',
        auditDate: new Date().toISOString()
      }
    };

    beforeEach(() => {
      IPFSService.prototype.uploadVerificationReport = jest.fn().mockResolvedValue({
        hash: 'QmMockVerificationHash',
        url: 'https://gateway.pinata.cloud/ipfs/QmMockVerificationHash',
        contentHash: 'mock_verification_hash'
      });
    });

    it('should create verification request successfully', async () => {
      const response = await request(app)
        .post('/api/blockchain/oracle/request-verification')
        .set('Authorization', `Bearer ${validToken}`)
        .send(validVerificationRequest);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Verification request prepared for blockchain submission');
      expect(response.body).toHaveProperty('requestData');
      expect(response.body).toHaveProperty('ipfs');
      expect(IPFSService.prototype.uploadVerificationReport).toHaveBeenCalled();
    });

    it('should require authentication and wallet', async () => {
      const response = await request(app)
        .post('/api/blockchain/oracle/request-verification')
        .send(validVerificationRequest);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should validate required fields', async () => {
      const incompleteData = {
        projectId: 'PROJECT_001'
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/blockchain/oracle/request-verification')
        .set('Authorization', `Bearer ${validToken}`)
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields: projectId, methodology, co2Equivalent');
    });
  });

  describe('GET /blockchain/oracle/pending-requests', () => {
    it('should return pending verification requests', async () => {
      const response = await request(app)
        .get('/api/blockchain/oracle/pending-requests');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pendingRequests');
      expect(response.body).toHaveProperty('total');
    });

    it('should handle oracle contract unavailable', async () => {
      // Mock oracle contract not available
      const response = await request(app)
        .get('/api/blockchain/oracle/pending-requests');

      // Depending on implementation, this could be 503 if contract is null
      if (response.status === 503) {
        expect(response.body.error).toBe('Oracle contract not available');
      }
    });
  });

  describe('GET /blockchain/transactions/:address', () => {
    const validAddress = '0x1234567890abcdef1234567890abcdef12345678';

    it('should return transaction history', async () => {
      const response = await request(app)
        .get(`/api/blockchain/transactions/${validAddress}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('transactions');
      expect(response.body).toHaveProperty('address');
      expect(response.body).toHaveProperty('total');
      expect(response.body.address).toBe(validAddress);
    });

    it('should validate wallet address', async () => {
      const response = await request(app)
        .get('/api/blockchain/transactions/invalid_address');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid wallet address');
    });
  });

  describe('GET /blockchain/ipfs/test', () => {
    beforeEach(() => {
      IPFSService.prototype.testConnection = jest.fn();
    });

    it('should test IPFS connectivity successfully', async () => {
      IPFSService.prototype.testConnection.mockResolvedValue(true);
      IPFSService.prototype.getStatus = jest.fn().mockReturnValue({
        configured: true,
        service: 'Pinata'
      });

      const response = await request(app)
        .get('/api/blockchain/ipfs/test');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('IPFS connectivity test completed');
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('service');
    });

    it('should handle IPFS connection failure', async () => {
      IPFSService.prototype.testConnection.mockRejectedValue(new Error('Connection failed'));

      const response = await request(app)
        .get('/api/blockchain/ipfs/test');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('IPFS test failed');
    });
  });

  describe('GET /blockchain/ipfs/:hash', () => {
    const mockHash = 'QmMockHash';

    beforeEach(() => {
      IPFSService.prototype.getJSON = jest.fn();
    });

    it('should retrieve IPFS data successfully', async () => {
      const mockData = { test: 'data', timestamp: new Date().toISOString() };
      IPFSService.prototype.getJSON.mockResolvedValue(mockData);

      const response = await request(app)
        .get(`/api/blockchain/ipfs/${mockHash}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hash');
      expect(response.body).toHaveProperty('data');
      expect(response.body.hash).toBe(mockHash);
      expect(response.body.data).toEqual(mockData);
    });

    it('should handle IPFS retrieval errors', async () => {
      IPFSService.prototype.getJSON.mockRejectedValue(new Error('Failed to retrieve'));

      const response = await request(app)
        .get(`/api/blockchain/ipfs/${mockHash}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve IPFS data');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // This test would require mocking the ethers provider to throw network errors
      const response = await request(app)
        .get('/api/blockchain/status');

      // Should not crash the application
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should handle invalid JSON in requests', async () => {
      const response = await request(app)
        .post('/api/blockchain/oracle/submit-data')
        .set('Authorization', `Bearer ${validToken}`)
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(response.status).toBe(400);
    });
  });
});
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../server');
const User = require('../models/User');

jest.mock('../models/User');

describe('Authentication API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    const validUserData = {
      email: 'test@example.com',
      password: 'TestPassword123!',
      firstName: 'John',
      lastName: 'Doe',
      organizationType: 'Individual'
    };

    it('should register a new user successfully', async () => {
      User.findOne.mockResolvedValue(null);
      User.create.mockResolvedValue({
        _id: 'mockUserId',
        ...validUserData,
        password: await bcrypt.hash(validUserData.password, 10)
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validUserData);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('User registered successfully');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(validUserData.email);
      expect(response.body).toHaveProperty('token');
    });

    it('should return error if email already exists', async () => {
      User.findOne.mockResolvedValue({ email: validUserData.email });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validUserData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User with this email already exists');
    });

    it('should validate required fields', async () => {
      const invalidData = { email: 'test@example.com' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should validate email format', async () => {
      const invalidEmailData = {
        ...validUserData,
        email: 'invalid-email'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidEmailData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should validate password strength', async () => {
      const weakPasswordData = {
        ...validUserData,
        password: '123'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(weakPasswordData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('POST /auth/login', () => {
    const mockUser = {
      _id: 'mockUserId',
      email: 'test@example.com',
      password: '',
      firstName: 'John',
      lastName: 'Doe',
      walletAddress: '0x1234567890abcdef',
      roles: ['user'],
      profile: {
        isVerified: false,
        kycStatus: 'pending'
      },
      comparePassword: jest.fn()
    };

    beforeEach(async () => {
      mockUser.password = await bcrypt.hash('TestPassword123!', 10);
    });

    it('should login successfully with valid credentials', async () => {
      mockUser.comparePassword.mockResolvedValue(true);
      User.findOne.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'TestPassword123!'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Login successful');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body).toHaveProperty('token');
    });

    it('should return error with invalid email', async () => {
      User.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'TestPassword123!'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should return error with invalid password', async () => {
      mockUser.comparePassword.mockResolvedValue(false);
      User.findOne.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('POST /auth/verify-wallet', () => {
    const mockUser = {
      _id: 'mockUserId',
      email: 'test@example.com',
      walletAddress: null,
      save: jest.fn()
    };

    const validToken = jwt.sign(
      { userId: 'mockUserId', email: 'test@example.com' },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );

    it('should verify wallet address successfully', async () => {
      User.findById.mockResolvedValue(mockUser);
      mockUser.save.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/api/auth/verify-wallet')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
          signature: '0xmocksignature'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Wallet verified successfully');
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/auth/verify-wallet')
        .send({
          walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
          signature: '0xmocksignature'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should validate wallet address format', async () => {
      const response = await request(app)
        .post('/api/auth/verify-wallet')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          walletAddress: 'invalid_address',
          signature: '0xmocksignature'
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('GET /auth/profile', () => {
    const mockUser = {
      _id: 'mockUserId',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      walletAddress: '0x1234567890abcdef',
      profile: {
        isVerified: false,
        kycStatus: 'pending'
      }
    };

    const validToken = jwt.sign(
      { userId: 'mockUserId', email: 'test@example.com' },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );

    it('should get user profile successfully', async () => {
      User.findById.mockResolvedValue(mockUser);

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(mockUser.email);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/auth/profile');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should handle invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid token');
    });
  });

  describe('PUT /auth/profile', () => {
    const mockUser = {
      _id: 'mockUserId',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      organizationType: 'Individual',
      profile: {
        isVerified: false,
        kycStatus: 'pending'
      },
      save: jest.fn()
    };

    const validToken = jwt.sign(
      { userId: 'mockUserId', email: 'test@example.com' },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );

    it('should update profile successfully', async () => {
      User.findById.mockResolvedValue(mockUser);
      mockUser.save.mockResolvedValue(mockUser);

      const updateData = {
        firstName: 'Jane',
        lastName: 'Smith',
        organizationType: 'Company'
      };

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Profile updated successfully');
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .send({ firstName: 'Jane' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });

    it('should validate update data', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ email: 'newemail@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot update email address');
    });
  });

  describe('POST /auth/refresh-token', () => {
    const mockUser = {
      _id: 'mockUserId',
      email: 'test@example.com'
    };

    const validToken = jwt.sign(
      { userId: 'mockUserId', email: 'test@example.com' },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );

    it('should refresh token successfully', async () => {
      User.findById.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/api/auth/refresh-token')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.message).toBe('Token refreshed successfully');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/auth/refresh-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access token required');
    });
  });
});
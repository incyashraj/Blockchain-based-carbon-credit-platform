const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// In-memory user storage for development (replace with database in production)
const inMemoryUsers = new Map();

// Helper function to create mock user object
const createMockUser = (userData) => {
    const userId = Date.now().toString();
    return {
        _id: userId,
        ...userData,
        profile: {
            isVerified: false,
            walletVerified: false,
            kycStatus: 'pending',
            carbonCreditsOwned: 125,
            carbonCreditsRetired: 45,
            totalTransactions: 8,
            reputationScore: 4.7
        },
        roles: ['user'],
        permissions: ['trade', 'view'],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
    };
};

// Initialize with demo user
const demoUser = createMockUser({
    email: 'demo@carboncredits.com',
    firstName: 'John',
    lastName: 'Doe',
    organizationType: 'individual',
    organization: null,
    walletAddress: '0xA848686157Ad328ca443f49f9a44800c2f9239D8'
});

// Create admin user
const adminUser = createMockUser({
    email: 'admin@carboncredits.com',
    firstName: 'Admin',
    lastName: 'User',
    organizationType: 'company',
    organization: 'Carbon Credits Platform',
    walletAddress: '0x742d35Cc6634C0532925a3b8D6Ac6cf24e3b234e'
});

// Override admin permissions
adminUser.roles = ['admin', 'user'];
adminUser.permissions = ['admin', 'trade', 'view', 'manage', 'verify'];
adminUser.profile.isVerified = true;
adminUser.profile.walletVerified = true;
adminUser.profile.kycStatus = 'verified';
adminUser.profile.reputationScore = 5.0;

// Hash the demo password
bcrypt.hash('demo123', 12).then(hashedPassword => {
    demoUser.password = hashedPassword;
    inMemoryUsers.set(demoUser.email, demoUser);
    console.log('✅ Demo user created: demo@carboncredits.com / demo123');
});

// Hash the admin password
bcrypt.hash('admin123', 12).then(hashedPassword => {
    adminUser.password = hashedPassword;
    inMemoryUsers.set(adminUser.email, adminUser);
    console.log('✅ Admin user created: admin@carboncredits.com / admin123');
});

// Register endpoint
router.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('firstName').trim().isLength({ min: 1 }).withMessage('First name is required'),
    body('lastName').trim().isLength({ min: 1 }).withMessage('Last name is required'),
    body('organizationType').isIn(['individual', 'company', 'ngo', 'government']).withMessage('Invalid organization type')
], async (req, res) => {
    try {
        console.log('🔐 Registration attempt:', req.body.email);
        
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password, firstName, lastName, organizationType, organization, walletAddress } = req.body;

        // Check if user already exists
        if (inMemoryUsers.has(email)) {
            return res.status(409).json({
                error: 'User already exists with this email'
            });
        }

        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create new user
        const user = createMockUser({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            organizationType,
            organization: organization || null,
            walletAddress: walletAddress || null
        });

        // Store user
        inMemoryUsers.set(email, user);

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRE }
        );

        // Return user data (excluding password)
        const userData = { ...user };
        delete userData.password;

        console.log('✅ User registered successfully:', email);

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: userData
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            error: 'Failed to register user',
            details: error.message
        });
    }
});

// Login endpoint
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 1 }).withMessage('Password is required')
], async (req, res) => {
    try {
        console.log('🔐 Login attempt:', req.body.email);
        
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        // Find user
        const user = inMemoryUsers.get(email);
        if (!user) {
            console.log('❌ User not found:', email);
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Update last login
        user.lastLogin = new Date().toISOString();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRE }
        );

        // Return user data (excluding password)
        const userData = { ...user };
        delete userData.password;

        console.log('✅ Login successful:', email);

        res.json({
            message: 'Login successful',
            token,
            user: userData
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Failed to login',
            details: error.message
        });
    }
});

// Get user profile
router.get('/profile', async (req, res) => {
    try {
        // Simple auth middleware inline for development
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const user = inMemoryUsers.get(decoded.email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = { ...user };
        delete userData.password;

        res.json({ user: userData });

    } catch (error) {
        console.error('Profile fetch error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        res.status(500).json({
            error: 'Failed to fetch profile',
            details: error.message
        });
    }
});

// Update user profile
router.put('/profile', async (req, res) => {
    try {
        // Simple auth middleware inline
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const user = inMemoryUsers.get(decoded.email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update allowed fields
        const allowedFields = ['firstName', 'lastName', 'organization', 'walletAddress'];
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                user[field] = req.body[field];
            }
        });

        const userData = { ...user };
        delete userData.password;

        console.log('✅ Profile updated for:', decoded.email);

        res.json({
            message: 'Profile updated successfully',
            user: userData
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            error: 'Failed to update profile',
            details: error.message
        });
    }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                error: 'Token is required'
            });
        }

        // Verify the token (even if expired)
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                // For expired tokens, decode without verification to get user info
                decoded = jwt.decode(token);
            } else {
                return res.status(401).json({
                    error: 'Invalid token'
                });
            }
        }

        // Find user
        const user = inMemoryUsers.get(decoded.email);
        if (!user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Generate new token
        const newToken = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRE }
        );

        const userData = { ...user };
        delete userData.password;

        res.json({
            message: 'Token refreshed successfully',
            token: newToken,
            user: userData
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Failed to refresh token',
            details: error.message
        });
    }
});

// Logout endpoint
router.post('/logout', (req, res) => {
    res.json({
        message: 'Logout successful'
    });
});

module.exports = router;
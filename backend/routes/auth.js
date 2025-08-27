const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth, requireWallet } = require('../middleware/auth');

const router = express.Router();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// Register endpoint
router.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('firstName').trim().isLength({ min: 1 }).withMessage('First name is required'),
    body('lastName').trim().isLength({ min: 1 }).withMessage('Last name is required'),
    body('organizationType').isIn(['individual', 'company', 'ngo', 'government']).withMessage('Invalid organization type')
], async (req, res) => {
    try {
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
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({
                error: 'User already exists with this email'
            });
        }

        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create new user
        const user = new User({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            organizationType,
            organization: organization || null,
            walletAddress: walletAddress || null,
            profile: {
                isVerified: false,
                kycStatus: 'pending',
                carbonCreditsOwned: 0,
                carbonCreditsRetired: 0,
                totalTransactions: 0
            }
        });

        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRE }
        );

        // Return user data (excluding password)
        const userData = user.toObject();
        delete userData.password;

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
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRE }
        );

        // Return user data (excluding password)
        const userData = user.toObject();
        delete userData.password;

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
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        
        if (!user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        res.json({
            user
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile',
            details: error.message
        });
    }
});

// Update user profile
router.put('/profile', auth, [
    body('firstName').optional().trim().isLength({ min: 1 }),
    body('lastName').optional().trim().isLength({ min: 1 }),
    body('organization').optional().trim(),
    body('walletAddress').optional().isEthereumAddress().withMessage('Invalid wallet address')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const updateData = {};
        const allowedFields = ['firstName', 'lastName', 'organization', 'walletAddress'];
        
        // Only include provided fields
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        });

        const user = await User.findByIdAndUpdate(
            req.userId,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        res.json({
            message: 'Profile updated successfully',
            user
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
        const user = await User.findById(decoded.userId).select('-password');
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

        res.json({
            message: 'Token refreshed successfully',
            token: newToken,
            user
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Failed to refresh token',
            details: error.message
        });
    }
});

// Change password endpoint
router.post('/change-password', auth, [
    body('currentPassword').isLength({ min: 1 }).withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;

        // Find user with password
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const saltRounds = 12;
        const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        user.password = hashedNewPassword;
        await user.save();

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({
            error: 'Failed to change password',
            details: error.message
        });
    }
});

// Logout endpoint (optional - mainly for client-side token removal)
router.post('/logout', auth, (req, res) => {
    res.json({
        message: 'Logout successful'
    });
});

// Verify wallet ownership endpoint
router.post('/verify-wallet', auth, [
    body('walletAddress').isEthereumAddress().withMessage('Invalid wallet address'),
    body('signature').isLength({ min: 1 }).withMessage('Signature is required'),
    body('message').isLength({ min: 1 }).withMessage('Message is required')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { walletAddress, signature, message } = req.body;

        // Verify the signature
        const { ethers } = require('ethers');
        
        try {
            const recoveredAddress = ethers.verifyMessage(message, signature);
            
            if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
                return res.status(400).json({
                    error: 'Signature verification failed'
                });
            }

            // Update user's wallet address as verified
            const user = await User.findByIdAndUpdate(
                req.userId,
                { 
                    walletAddress: walletAddress,
                    'profile.walletVerified': true
                },
                { new: true }
            ).select('-password');

            res.json({
                message: 'Wallet verified successfully',
                walletAddress: recoveredAddress,
                user
            });

        } catch (error) {
            return res.status(400).json({
                error: 'Invalid signature',
                details: error.message
            });
        }

    } catch (error) {
        console.error('Wallet verification error:', error);
        res.status(500).json({
            error: 'Failed to verify wallet',
            details: error.message
        });
    }
});

module.exports = router;
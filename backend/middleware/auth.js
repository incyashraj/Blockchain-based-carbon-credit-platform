const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

// Authentication middleware
const auth = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            return res.status(401).json({
                error: 'No token provided',
                message: 'Access denied'
            });
        }

        // Check if token starts with 'Bearer '
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Invalid token format',
                message: 'Token must be in format: Bearer <token>'
            });
        }

        // Extract token
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Find user
        const user = await User.findById(decoded.userId).select('-password');
        
        if (!user) {
            return res.status(401).json({
                error: 'User not found',
                message: 'Invalid token'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                error: 'Account deactivated',
                message: 'Account has been deactivated'
            });
        }

        // Add user info to request
        req.userId = user._id;
        req.user = user;
        req.userEmail = user.email;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'Token is malformed or invalid'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'Please login again'
            });
        }

        res.status(500).json({
            error: 'Authentication error',
            message: 'Failed to authenticate token'
        });
    }
};

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next(); // Continue without authentication
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        
        if (user && user.isActive) {
            req.userId = user._id;
            req.user = user;
            req.userEmail = user.email;
        }
        
        next();
    } catch (error) {
        // Continue without authentication on error
        next();
    }
};

// Role-based authorization middleware
const authorize = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please login to access this resource'
            });
        }

        // Convert single role to array
        if (typeof roles === 'string') {
            roles = [roles];
        }

        // Check if user has any of the required roles
        const hasRole = roles.some(role => req.user.roles.includes(role));
        
        // Admin can access everything
        const isAdmin = req.user.roles.includes('admin');

        if (!hasRole && !isAdmin) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `Access denied. Required roles: ${roles.join(', ')}`,
                userRoles: req.user.roles
            });
        }

        next();
    };
};

// Permission-based authorization middleware
const requirePermission = (permissions = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please login to access this resource'
            });
        }

        // Convert single permission to array
        if (typeof permissions === 'string') {
            permissions = [permissions];
        }

        // Check if user has any of the required permissions
        const hasPermission = permissions.some(permission => 
            req.user.hasPermission(permission)
        );

        if (!hasPermission) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `Access denied. Required permissions: ${permissions.join(', ')}`,
                userPermissions: req.user.permissions
            });
        }

        next();
    };
};

// Verified users only middleware
const requireVerification = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please login to access this resource'
        });
    }

    if (!req.user.profile.isVerified) {
        return res.status(403).json({
            error: 'Verification required',
            message: 'Please verify your account to access this resource',
            verificationStatus: req.user.profile.kycStatus
        });
    }

    next();
};

// Wallet connection required middleware
const requireWallet = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please login to access this resource'
        });
    }

    if (!req.user.walletAddress) {
        return res.status(403).json({
            error: 'Wallet connection required',
            message: 'Please connect your wallet to access this resource'
        });
    }

    if (!req.user.profile.walletVerified) {
        return res.status(403).json({
            error: 'Wallet verification required',
            message: 'Please verify your wallet ownership to access this resource'
        });
    }

    next();
};

// API key authentication middleware
const apiKeyAuth = async (req, res, next) => {
    try {
        // Get API key from header or query parameter
        const apiKey = req.header('X-API-Key') || req.query.apiKey;
        
        if (!apiKey) {
            return res.status(401).json({
                error: 'API key required',
                message: 'Please provide API key in X-API-Key header or apiKey query parameter'
            });
        }

        // Find user with this API key
        const user = await User.findOne({
            'apiKeys.key': apiKey,
            'apiKeys.isActive': true,
            isActive: true
        }).select('-password');

        if (!user) {
            return res.status(401).json({
                error: 'Invalid API key',
                message: 'API key not found or inactive'
            });
        }

        // Find the specific API key to update last used
        const apiKeyObj = user.apiKeys.find(ak => ak.key === apiKey && ak.isActive);
        
        if (apiKeyObj) {
            apiKeyObj.lastUsed = new Date();
            await user.save();
        }

        // Add user info to request
        req.userId = user._id;
        req.user = user;
        req.userEmail = user.email;
        req.apiKey = apiKeyObj;

        next();
    } catch (error) {
        console.error('API key auth error:', error);
        res.status(500).json({
            error: 'Authentication error',
            message: 'Failed to authenticate API key'
        });
    }
};

// Rate limiting middleware (simple implementation)
const rateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    const requests = new Map();

    return (req, res, next) => {
        const identifier = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        // Clean old entries
        for (const [key, data] of requests.entries()) {
            if (now - data.resetTime > windowMs) {
                requests.delete(key);
            }
        }

        // Get or create user request data
        let userRequests = requests.get(identifier);
        if (!userRequests || now - userRequests.resetTime > windowMs) {
            userRequests = {
                count: 0,
                resetTime: now
            };
            requests.set(identifier, userRequests);
        }

        // Check if limit exceeded
        if (userRequests.count >= maxRequests) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                message: `Maximum ${maxRequests} requests per ${windowMs/1000/60} minutes`,
                retryAfter: Math.ceil((windowMs - (now - userRequests.resetTime)) / 1000)
            });
        }

        // Increment count
        userRequests.count++;

        // Add rate limit headers
        res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': Math.max(0, maxRequests - userRequests.count),
            'X-RateLimit-Reset': new Date(userRequests.resetTime + windowMs).toISOString()
        });

        next();
    };
};

module.exports = {
    auth,
    optionalAuth,
    authorize,
    requirePermission,
    requireVerification,
    requireWallet,
    apiKeyAuth,
    rateLimit
};
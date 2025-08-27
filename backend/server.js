const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Enhanced Database connection with fallback
const connectDatabase = async () => {
    const mongoUris = [
        process.env.MONGODB_ATLAS_URI,
        process.env.MONGODB_URI,
        'mongodb://localhost:27017/carbon-credits'
    ].filter(Boolean);

    for (const uri of mongoUris) {
        try {
            console.log(`🔗 Attempting to connect to MongoDB: ${uri.replace(/\/\/.*@/, '//****@')}`);
            await mongoose.connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000, // 5 second timeout
                connectTimeoutMS: 5000
            });
            console.log('✅ Connected to MongoDB');
            return;
        } catch (error) {
            console.warn(`⚠️ MongoDB connection failed: ${error.message}`);
            continue;
        }
    }
    
    console.error('❌ All MongoDB connection attempts failed. Running in database-less mode.');
    console.log('💡 For full functionality, please set up MongoDB or use MongoDB Atlas');
};

// Connect to database
connectDatabase();

// Enhanced Polygon provider setup with fallback
const createProvider = () => {
    const rpcUrls = [
        process.env.POLYGON_RPC_URL || process.env.ETHEREUM_RPC_URL,
        process.env.BACKUP_RPC_1,
        process.env.BACKUP_RPC_2,
        'https://polygon-rpc.com',
        'https://rpc.ankr.com/polygon'
    ].filter(Boolean);

    for (const rpcUrl of rpcUrls) {
        try {
            console.log(`🔗 Attempting to connect to: ${rpcUrl}`);
            return new ethers.JsonRpcProvider(rpcUrl, {
                name: process.env.NETWORK_NAME || 'polygon',
                chainId: parseInt(process.env.CHAIN_ID) || 137
            });
        } catch (error) {
            console.warn(`⚠️ Failed to connect to ${rpcUrl}:`, error.message);
            continue;
        }
    }
    
    console.warn('⚠️ All RPC providers failed, using default');
    return new ethers.JsonRpcProvider('https://polygon-rpc.com', {
        name: 'polygon',
        chainId: 137
    });
};

const provider = createProvider();

// Contract configurations
const CONTRACT_ADDRESSES = {
    carbonToken: process.env.CARBON_TOKEN_ADDRESS || '',
    carbonOracle: process.env.CARBON_ORACLE_ADDRESS || '',
    carbonMarketplace: process.env.CARBON_MARKETPLACE_ADDRESS || ''
};

// Import route handlers
const authRoutes = require('./routes/auth');
const blockchainRoutes = require('./routes/blockchain');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/blockchain', blockchainRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Check database connection
        const readyState = mongoose.connection.readyState;
        const dbStatus = readyState === 1 ? 'connected' : 
                        readyState === 2 ? 'connecting' : 
                        readyState === 3 ? 'disconnecting' : 'disconnected';
        
        // Check blockchain connection with enhanced error handling
        let blockchainStatus = 'disconnected';
        let blockNumber = 0;
        let networkName = 'unknown';
        let chainId = 0;
        
        try {
            // Get network information
            const network = await provider.getNetwork();
            networkName = network.name;
            chainId = Number(network.chainId);
            
            // Get latest block
            blockNumber = await provider.getBlockNumber();
            blockchainStatus = 'connected';
            
            console.log(`✅ Connected to ${networkName} (Chain ID: ${chainId}), Block: ${blockNumber}`);
        } catch (error) {
            console.error('Blockchain connection error:', error.message);
            // Try to reconnect with a different provider
            try {
                console.log('🔄 Attempting fallback connection...');
                const fallbackProvider = new ethers.JsonRpcProvider('https://rpc.ankr.com/polygon');
                blockNumber = await fallbackProvider.getBlockNumber();
                blockchainStatus = 'connected-fallback';
            } catch (fallbackError) {
                console.error('Fallback connection also failed:', fallbackError.message);
            }
        }
        
        // Check AI verification service
        let aiServiceStatus = 'disconnected';
        try {
            const aiResponse = await axios.get('http://localhost:5000/health', { timeout: 5000 });
            aiServiceStatus = aiResponse.data.status === 'healthy' ? 'connected' : 'error';
        } catch (error) {
            console.log('AI service not available:', error.message);
        }
        
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: {
                    status: dbStatus,
                    connection: mongoose.connection.name || 'unknown'
                },
                blockchain: {
                    status: blockchainStatus,
                    network: networkName,
                    chainId: chainId,
                    blockNumber: blockNumber,
                    rpcUrl: process.env.POLYGON_RPC_URL || process.env.ETHEREUM_RPC_URL
                },
                ai_verification: {
                    status: aiServiceStatus,
                    endpoint: 'http://localhost:5000'
                }
            },
            contracts: CONTRACT_ADDRESSES,
            version: '1.0.0',
            uptime: process.uptime()
        };
        
        res.json(health);
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ 
            status: 'error', 
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Carbon Credit Blockchain API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            api: '/api'
        }
    });
});

// API documentation endpoint
app.get('/api', (req, res) => {
    const apiDoc = {
        title: 'Carbon Credit Blockchain API',
        version: '1.0.0',
        description: 'REST API for carbon credit tokenization, trading, and verification',
        baseUrl: `${req.protocol}://${req.get('host')}/api`,
        endpoints: {
            authentication: {
                'POST /auth/register': 'Register new user',
                'POST /auth/login': 'User login',
                'POST /auth/refresh': 'Refresh JWT token',
                'GET /auth/profile': 'Get user profile'
            },
            projects: {
                'GET /projects': 'List all carbon credit projects',
                'POST /projects': 'Create new project',
                'GET /projects/:id': 'Get project details',
                'PUT /projects/:id': 'Update project',
                'DELETE /projects/:id': 'Delete project'
            },
            verification: {
                'POST /verification/submit': 'Submit sensor data for verification',
                'GET /verification/requests': 'List verification requests',
                'POST /verification/approve/:id': 'Approve verification request',
                'GET /verification/status/:id': 'Check verification status'
            },
            marketplace: {
                'GET /marketplace/listings': 'Get active marketplace listings',
                'POST /marketplace/list': 'Create new listing',
                'POST /marketplace/purchase': 'Purchase carbon credits',
                'GET /marketplace/auctions': 'Get active auctions',
                'POST /marketplace/bid': 'Place auction bid'
            },
            blockchain: {
                'GET /blockchain/credits/:tokenId': 'Get credit information',
                'POST /blockchain/mint': 'Mint new carbon credits',
                'POST /blockchain/retire': 'Retire carbon credits',
                'GET /blockchain/transactions': 'Get transaction history'
            },
            analytics: {
                'GET /analytics/dashboard': 'Get dashboard statistics',
                'GET /analytics/emissions': 'Get emissions data',
                'GET /analytics/market': 'Get market analytics',
                'GET /analytics/projects/:id/metrics': 'Get project metrics'
            }
        },
        schemas: {
            project: {
                name: 'string',
                description: 'string',
                methodology: 'string',
                location: 'object',
                expectedCO2Reduction: 'number',
                timeline: 'object'
            },
            sensorData: {
                sensor_id: 'string',
                timestamp: 'string',
                measurements: 'object',
                location: 'object',
                data_hash: 'string'
            }
        }
    };
    
    res.json(apiDoc);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('API Error:', error);
    
    // Mongoose validation errors
    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(e => e.message);
        return res.status(400).json({
            error: 'Validation Error',
            details: errors
        });
    }
    
    // JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Invalid token'
        });
    }
    
    // Mongoose cast errors
    if (error.name === 'CastError') {
        return res.status(400).json({
            error: 'Invalid ID format'
        });
    }
    
    // Default error
    res.status(error.status || 500).json({
        error: error.message || 'Internal Server Error',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    try {
        // Close database connection
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
        
        // Close server
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

// Start server
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log('\n🚀 Carbon Credit API Server Started');
    console.log('=====================================');
    console.log(`🌐 Server: http://${HOST}:${PORT}`);
    console.log(`📚 API Docs: http://${HOST}:${PORT}/api`);
    console.log(`❤️  Health: http://${HOST}:${PORT}/health`);
    console.log(`🔗 MongoDB: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-credits'}`);
    console.log(`⛓️  Blockchain: ${process.env.POLYGON_RPC_URL || process.env.ETHEREUM_RPC_URL || 'https://polygon-rpc.com'} (Polygon Chain ID: ${process.env.CHAIN_ID || 137})`);
    console.log(`🤖 AI Service: http://localhost:5000`);
    console.log('=====================================\n');
});

module.exports = app;
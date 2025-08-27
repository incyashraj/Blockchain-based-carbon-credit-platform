const express = require('express');
const { ethers } = require('ethers');
const { auth, requireWallet } = require('../middleware/auth');
const IPFSService = require('../utils/ipfs');

const router = express.Router();

// Initialize IPFS service
const ipfsService = new IPFSService();

// Contract configurations
const CONTRACT_ADDRESSES = {
    carbonToken: process.env.CARBON_TOKEN_ADDRESS || '',
    carbonOracle: process.env.CARBON_ORACLE_ADDRESS || '',
    carbonMarketplace: process.env.CARBON_MARKETPLACE_ADDRESS || ''
};

// Initialize blockchain provider
const provider = new ethers.JsonRpcProvider(
    process.env.ETHEREUM_RPC_URL || 'http://127.0.0.1:8545'
);

// Contract ABIs (simplified - in production, import from compiled contracts)
const carbonTokenABI = [
    "function getCreditInfo(uint256 tokenId) view returns (tuple(uint256 tokenId, uint256 totalSupply, uint256 availableSupply, string projectId, string methodology, uint256 co2Equivalent, uint256 issuanceDate, uint256 expirationDate, string ipfsHash, bool verified, address issuer, uint8 status))",
    "function getActiveCredits() view returns (uint256[])",
    "function getUserCredits(address user) view returns (uint256[])",
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function retireCredit(uint256 tokenId, uint256 amount)",
    "event CreditMinted(uint256 indexed tokenId, string indexed projectId, uint256 co2Equivalent, address indexed issuer)",
    "event CreditRetired(uint256 indexed tokenId, uint256 amount, address indexed retiree)"
];

const carbonMarketplaceABI = [
    "function listings(uint256 listingId) view returns (tuple(uint256 listingId, uint256 tokenId, address seller, uint256 amount, uint256 pricePerCredit, uint256 createdAt, uint256 expiresAt, bool active, uint8 listingType))",
    "function getActiveListings() view returns (uint256[])",
    "function totalVolume() view returns (uint256)",
    "function totalTransactions() view returns (uint256)"
];

const carbonOracleABI = [
    "function submitEmissionData(string sensorId, uint256 co2Reading, uint256 location, string dataHash) returns (uint256)",
    "function requestVerification(string projectId, uint256[] emissionDataIds, string methodology, uint256 co2Equivalent, string ipfsHash) returns (uint256)",
    "function getPendingRequests() view returns (uint256[])"
];

// Initialize contracts
const carbonToken = CONTRACT_ADDRESSES.carbonToken ? 
    new ethers.Contract(CONTRACT_ADDRESSES.carbonToken, carbonTokenABI, provider) : null;

const carbonMarketplace = CONTRACT_ADDRESSES.carbonMarketplace ? 
    new ethers.Contract(CONTRACT_ADDRESSES.carbonMarketplace, carbonMarketplaceABI, provider) : null;

const carbonOracle = CONTRACT_ADDRESSES.carbonOracle ? 
    new ethers.Contract(CONTRACT_ADDRESSES.carbonOracle, carbonOracleABI, provider) : null;

// Get blockchain status
router.get('/status', async (req, res) => {
    try {
        const status = {
            provider: {
                connected: true,
                network: await provider.getNetwork(),
                blockNumber: await provider.getBlockNumber()
            },
            contracts: {
                carbonToken: {
                    address: CONTRACT_ADDRESSES.carbonToken,
                    deployed: !!carbonToken
                },
                carbonMarketplace: {
                    address: CONTRACT_ADDRESSES.carbonMarketplace,
                    deployed: !!carbonMarketplace
                },
                carbonOracle: {
                    address: CONTRACT_ADDRESSES.carbonOracle,
                    deployed: !!carbonOracle
                }
            },
            ipfs: ipfsService.getStatus()
        };

        res.json(status);
    } catch (error) {
        console.error('Blockchain status error:', error);
        res.status(500).json({
            error: 'Failed to get blockchain status',
            details: error.message
        });
    }
});

// Get carbon credit information
router.get('/credits/:tokenId', async (req, res) => {
    try {
        const { tokenId } = req.params;

        if (!carbonToken) {
            return res.status(503).json({
                error: 'Carbon token contract not available'
            });
        }

        const creditInfo = await carbonToken.getCreditInfo(tokenId);
        
        // Format the response
        const formattedCredit = {
            tokenId: creditInfo.tokenId.toString(),
            totalSupply: creditInfo.totalSupply.toString(),
            availableSupply: creditInfo.availableSupply.toString(),
            projectId: creditInfo.projectId,
            methodology: creditInfo.methodology,
            co2Equivalent: creditInfo.co2Equivalent.toString(),
            issuanceDate: new Date(Number(creditInfo.issuanceDate) * 1000).toISOString(),
            expirationDate: new Date(Number(creditInfo.expirationDate) * 1000).toISOString(),
            ipfsHash: creditInfo.ipfsHash,
            verified: creditInfo.verified,
            issuer: creditInfo.issuer,
            status: creditInfo.status // 0: PENDING, 1: VERIFIED, 2: ACTIVE, 3: RETIRED, 4: CANCELLED
        };

        // Fetch additional data from IPFS if available
        if (creditInfo.ipfsHash) {
            try {
                const ipfsData = await ipfsService.getJSON(creditInfo.ipfsHash);
                formattedCredit.metadata = ipfsData;
            } catch (ipfsError) {
                console.error('Failed to fetch IPFS data:', ipfsError);
            }
        }

        res.json({
            credit: formattedCredit
        });
    } catch (error) {
        console.error('Get credit error:', error);
        res.status(500).json({
            error: 'Failed to get credit information',
            details: error.message
        });
    }
});

// Get active carbon credits
router.get('/credits', async (req, res) => {
    try {
        if (!carbonToken) {
            return res.status(503).json({
                error: 'Carbon token contract not available'
            });
        }

        const activeTokenIds = await carbonToken.getActiveCredits();
        
        // Get detailed information for each credit
        const credits = await Promise.all(
            activeTokenIds.map(async (tokenId) => {
                try {
                    const creditInfo = await carbonToken.getCreditInfo(tokenId);
                    return {
                        tokenId: creditInfo.tokenId.toString(),
                        projectId: creditInfo.projectId,
                        methodology: creditInfo.methodology,
                        co2Equivalent: creditInfo.co2Equivalent.toString(),
                        availableSupply: creditInfo.availableSupply.toString(),
                        priceEstimate: Math.floor(Math.random() * 50 + 10), // Mock price
                        verified: creditInfo.verified,
                        issuer: creditInfo.issuer
                    };
                } catch (error) {
                    console.error(`Failed to get info for token ${tokenId}:`, error);
                    return null;
                }
            })
        );

        res.json({
            credits: credits.filter(credit => credit !== null),
            total: activeTokenIds.length
        });
    } catch (error) {
        console.error('Get active credits error:', error);
        res.status(500).json({
            error: 'Failed to get active credits',
            details: error.message
        });
    }
});

// Get user's carbon credits
router.get('/credits/user/:address', async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid wallet address'
            });
        }

        if (!carbonToken) {
            return res.status(503).json({
                error: 'Carbon token contract not available'
            });
        }

        const userTokenIds = await carbonToken.getUserCredits(address);
        
        // Get balances and detailed information
        const userCredits = await Promise.all(
            userTokenIds.map(async (tokenId) => {
                try {
                    const [creditInfo, balance] = await Promise.all([
                        carbonToken.getCreditInfo(tokenId),
                        carbonToken.balanceOf(address, tokenId)
                    ]);

                    return {
                        tokenId: creditInfo.tokenId.toString(),
                        projectId: creditInfo.projectId,
                        methodology: creditInfo.methodology,
                        co2Equivalent: creditInfo.co2Equivalent.toString(),
                        balance: balance.toString(),
                        verified: creditInfo.verified,
                        status: creditInfo.status
                    };
                } catch (error) {
                    console.error(`Failed to get user credit info for token ${tokenId}:`, error);
                    return null;
                }
            })
        );

        res.json({
            address,
            credits: userCredits.filter(credit => credit !== null),
            total: userTokenIds.length
        });
    } catch (error) {
        console.error('Get user credits error:', error);
        res.status(500).json({
            error: 'Failed to get user credits',
            details: error.message
        });
    }
});

// Get marketplace listings
router.get('/marketplace/listings', async (req, res) => {
    try {
        if (!carbonMarketplace) {
            return res.status(503).json({
                error: 'Marketplace contract not available'
            });
        }

        const activeListingIds = await carbonMarketplace.getActiveListings();
        
        const listings = await Promise.all(
            activeListingIds.map(async (listingId) => {
                try {
                    const listing = await carbonMarketplace.listings(listingId);
                    return {
                        listingId: listing.listingId.toString(),
                        tokenId: listing.tokenId.toString(),
                        seller: listing.seller,
                        amount: listing.amount.toString(),
                        pricePerCredit: ethers.formatEther(listing.pricePerCredit),
                        createdAt: new Date(Number(listing.createdAt) * 1000).toISOString(),
                        expiresAt: new Date(Number(listing.expiresAt) * 1000).toISOString(),
                        active: listing.active,
                        listingType: listing.listingType
                    };
                } catch (error) {
                    console.error(`Failed to get listing ${listingId}:`, error);
                    return null;
                }
            })
        );

        res.json({
            listings: listings.filter(listing => listing !== null),
            total: activeListingIds.length
        });
    } catch (error) {
        console.error('Get marketplace listings error:', error);
        res.status(500).json({
            error: 'Failed to get marketplace listings',
            details: error.message
        });
    }
});

// Submit sensor data for verification
router.post('/oracle/submit-data', [auth, requireWallet], async (req, res) => {
    try {
        const { sensorId, sensorData, location } = req.body;

        if (!sensorId || !sensorData) {
            return res.status(400).json({
                error: 'Missing required fields: sensorId, sensorData'
            });
        }

        // Upload sensor data to IPFS
        const ipfsResult = await ipfsService.uploadSensorData(sensorData, sensorId);
        
        // Prepare data for blockchain submission
        const co2Reading = Math.floor(sensorData.measurements?.co2_ppm || 0);
        const locationData = location ? 
            (location.lat * 1000000 + location.lon * 1000000) : 0; // Simple encoding

        // This would typically be submitted via a signed transaction
        // For now, we'll store the data and return the IPFS hash
        const submissionData = {
            sensorId,
            co2Reading,
            location: locationData,
            ipfsHash: ipfsResult.hash,
            dataHash: ipfsResult.contentHash,
            timestamp: new Date().toISOString(),
            submitter: req.user.walletAddress
        };

        res.json({
            message: 'Sensor data prepared for blockchain submission',
            submissionData,
            ipfs: {
                hash: ipfsResult.hash,
                url: ipfsResult.url
            }
        });
    } catch (error) {
        console.error('Submit sensor data error:', error);
        res.status(500).json({
            error: 'Failed to submit sensor data',
            details: error.message
        });
    }
});

// Request verification for a project
router.post('/oracle/request-verification', [auth, requireWallet], async (req, res) => {
    try {
        const { projectId, methodology, co2Equivalent, emissionDataIds, verificationData } = req.body;

        if (!projectId || !methodology || !co2Equivalent) {
            return res.status(400).json({
                error: 'Missing required fields: projectId, methodology, co2Equivalent'
            });
        }

        // Upload verification data to IPFS
        const verificationReport = {
            projectId,
            methodology,
            co2Equivalent,
            emissionDataIds: emissionDataIds || [],
            verificationData: verificationData || {},
            requestedBy: req.user.walletAddress,
            requestedAt: new Date().toISOString()
        };

        const ipfsResult = await ipfsService.uploadVerificationReport(verificationReport, projectId);

        // Prepare verification request
        const requestData = {
            projectId,
            emissionDataIds: emissionDataIds || [],
            methodology,
            co2Equivalent: Math.floor(co2Equivalent),
            ipfsHash: ipfsResult.hash,
            requester: req.user.walletAddress
        };

        res.json({
            message: 'Verification request prepared for blockchain submission',
            requestData,
            ipfs: {
                hash: ipfsResult.hash,
                url: ipfsResult.url
            }
        });
    } catch (error) {
        console.error('Request verification error:', error);
        res.status(500).json({
            error: 'Failed to request verification',
            details: error.message
        });
    }
});

// Get pending verification requests
router.get('/oracle/pending-requests', async (req, res) => {
    try {
        if (!carbonOracle) {
            return res.status(503).json({
                error: 'Oracle contract not available'
            });
        }

        const pendingRequestIds = await carbonOracle.getPendingRequests();
        
        res.json({
            pendingRequests: pendingRequestIds.map(id => id.toString()),
            total: pendingRequestIds.length
        });
    } catch (error) {
        console.error('Get pending requests error:', error);
        res.status(500).json({
            error: 'Failed to get pending requests',
            details: error.message
        });
    }
});

// Get transaction history for a user
router.get('/transactions/:address', async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid wallet address'
            });
        }

        // This would typically query blockchain events
        // For now, return mock transaction history
        const mockTransactions = [
            {
                hash: '0x1234567890abcdef',
                type: 'mint',
                tokenId: '1',
                amount: '100',
                from: '0x0000000000000000000000000000000000000000',
                to: address,
                timestamp: new Date(Date.now() - 86400000).toISOString(),
                status: 'confirmed'
            },
            {
                hash: '0xabcdef1234567890',
                type: 'transfer',
                tokenId: '1',
                amount: '25',
                from: address,
                to: '0x9876543210fedcba',
                timestamp: new Date(Date.now() - 43200000).toISOString(),
                status: 'confirmed'
            }
        ];

        res.json({
            address,
            transactions: mockTransactions,
            total: mockTransactions.length
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            error: 'Failed to get transaction history',
            details: error.message
        });
    }
});

// Test IPFS connectivity
router.get('/ipfs/test', async (req, res) => {
    try {
        const testResult = await ipfsService.testConnection();
        
        res.json({
            message: 'IPFS connectivity test completed',
            success: testResult,
            service: ipfsService.getStatus()
        });
    } catch (error) {
        console.error('IPFS test error:', error);
        res.status(500).json({
            error: 'IPFS test failed',
            details: error.message
        });
    }
});

// Get IPFS data
router.get('/ipfs/:hash', async (req, res) => {
    try {
        const { hash } = req.params;
        
        const data = await ipfsService.getJSON(hash);
        
        res.json({
            hash,
            data
        });
    } catch (error) {
        console.error('Get IPFS data error:', error);
        res.status(500).json({
            error: 'Failed to retrieve IPFS data',
            details: error.message
        });
    }
});

module.exports = router;
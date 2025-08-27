const express = require('express');
const { body, query, validationResult } = require('express-validator');
const CarbonCredit = require('../models/CarbonCredit');
const Transaction = require('../models/Transaction');
const Project = require('../models/Project');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get marketplace carbon credits with filters
router.get('/credits', [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('projectType').optional().isString(),
    query('priceMin').optional().isFloat({ min: 0 }),
    query('priceMax').optional().isFloat({ min: 0 }),
    query('vintage').optional().isString(),
    query('location').optional().isString(),
    query('verificationStatus').optional().isIn(['Verified', 'Pending']),
    query('search').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const {
            page = 1,
            limit = 20,
            projectType,
            priceMin,
            priceMax,
            vintage,
            location,
            verificationStatus,
            search
        } = req.query;

        // Build filter query
        let filter = { 
            isListed: true,
            status: 'Active',
            quantity: { $gt: 0 }
        };

        if (projectType) filter.projectType = projectType;
        if (vintage) filter.vintage = vintage;
        if (location) filter.location = new RegExp(location, 'i');
        if (verificationStatus) filter.verificationStatus = verificationStatus;
        
        if (priceMin || priceMax) {
            filter.pricePerTonne = {};
            if (priceMin) filter.pricePerTonne.$gte = parseFloat(priceMin);
            if (priceMax) filter.pricePerTonne.$lte = parseFloat(priceMax);
        }

        if (search) {
            filter.$or = [
                { projectName: new RegExp(search, 'i') },
                { methodology: new RegExp(search, 'i') },
                { location: new RegExp(search, 'i') }
            ];
        }

        // Execute query with pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const credits = await CarbonCredit
            .find(filter)
            .populate('owner', 'firstName lastName organization')
            .populate('projectId', 'name status')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await CarbonCredit.countDocuments(filter);
        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            success: true,
            data: credits,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('Marketplace credits error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch marketplace credits',
            details: error.message
        });
    }
});

// Get specific credit details
router.get('/credits/:creditId', async (req, res) => {
    try {
        const credit = await CarbonCredit
            .findById(req.params.creditId)
            .populate('owner', 'firstName lastName organization')
            .populate('projectId')
            .populate('transferHistory.from transferHistory.to', 'firstName lastName organization');

        if (!credit) {
            return res.status(404).json({
                success: false,
                error: 'Credit not found'
            });
        }

        res.json({
            success: true,
            data: credit
        });
    } catch (error) {
        console.error('Get credit error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch credit details',
            details: error.message
        });
    }
});

// Purchase carbon credits
router.post('/credits/:creditId/purchase', auth, [
    body('quantity').isInt({ min: 1 }),
    body('paymentMethod').optional().isIn(['crypto', 'bank_transfer', 'credit_card'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { quantity, paymentMethod = 'crypto' } = req.body;
        const creditId = req.params.creditId;

        // Find the credit
        const credit = await CarbonCredit.findById(creditId);
        if (!credit) {
            return res.status(404).json({
                success: false,
                error: 'Credit not found'
            });
        }

        // Check availability
        if (!credit.isListed || credit.quantity < quantity) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient credits available'
            });
        }

        // Check if user is trying to buy their own credits
        if (credit.owner.toString() === req.user.id) {
            return res.status(400).json({
                success: false,
                error: 'Cannot purchase your own credits'
            });
        }

        const totalPrice = quantity * credit.pricePerTonne;

        // Create transaction record
        const transaction = new Transaction({
            type: 'purchase',
            user: req.user.id,
            counterparty: credit.owner,
            creditId: creditId,
            projectId: credit.projectId,
            quantity: quantity,
            pricePerTonne: credit.pricePerTonne,
            paymentData: {
                method: paymentMethod,
                paymentStatus: 'pending'
            }
        });

        // In a real implementation, you would:
        // 1. Process payment
        // 2. Execute blockchain transaction
        // 3. Update credit ownership

        // For demo, we'll simulate success
        transaction.status = 'completed';
        transaction.completedAt = new Date();
        transaction.blockchainData = {
            transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
            blockNumber: Math.floor(Math.random() * 1000000),
            network: 'polygon'
        };

        await transaction.save();

        // Update credit quantity and transfer
        if (credit.quantity === quantity) {
            // Full purchase - transfer ownership
            credit.owner = req.user.id;
            credit.isListed = false;
        } else {
            // Partial purchase - create new credit for buyer
            const newCredit = new CarbonCredit({
                ...credit.toObject(),
                _id: undefined,
                tokenId: credit.tokenId + '_' + Date.now(),
                quantity: quantity,
                owner: req.user.id,
                isListed: false,
                status: 'Active'
            });
            await newCredit.save();
        }

        credit.quantity -= quantity;
        if (credit.quantity === 0) {
            credit.isListed = false;
        }

        // Add to transfer history
        credit.transferHistory.push({
            from: credit.owner,
            to: req.user.id,
            quantity: quantity,
            price: credit.pricePerTonne,
            transactionHash: transaction.blockchainData.transactionHash
        });

        await credit.save();

        res.json({
            success: true,
            message: 'Purchase completed successfully',
            data: {
                transactionId: transaction.transactionId,
                transactionHash: transaction.blockchainData.transactionHash,
                totalPrice: totalPrice,
                quantity: quantity
            }
        });
    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to complete purchase',
            details: error.message
        });
    }
});

// List credit for sale
router.post('/credits/:creditId/list', auth, [
    body('pricePerTonne').isFloat({ min: 0.01 }),
    body('quantity').isInt({ min: 1 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { pricePerTonne, quantity } = req.body;
        const creditId = req.params.creditId;

        const credit = await CarbonCredit.findById(creditId);
        if (!credit) {
            return res.status(404).json({
                success: false,
                error: 'Credit not found'
            });
        }

        // Check ownership
        if (credit.owner.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'You can only list your own credits'
            });
        }

        // Check if sufficient quantity available
        if (credit.quantity < quantity) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient credits available'
            });
        }

        // Update listing
        credit.isListed = true;
        credit.pricePerTonne = pricePerTonne;
        credit.listingId = 'LIST-' + Date.now();

        await credit.save();

        res.json({
            success: true,
            message: 'Credit listed successfully',
            data: {
                listingId: credit.listingId,
                pricePerTonne: credit.pricePerTonne,
                quantity: credit.quantity
            }
        });
    } catch (error) {
        console.error('Listing error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list credit',
            details: error.message
        });
    }
});

// Get market analytics
router.get('/analytics', async (req, res) => {
    try {
        const totalCredits = await CarbonCredit.countDocuments({ status: 'Active' });
        const listedCredits = await CarbonCredit.countDocuments({ isListed: true });
        const verifiedCredits = await CarbonCredit.countDocuments({ verificationStatus: 'Verified' });
        
        const recentTransactions = await Transaction
            .find({ status: 'completed' })
            .sort({ createdAt: -1 })
            .limit(10);

        const totalVolume = await Transaction.aggregate([
            { $match: { status: 'completed', type: { $in: ['purchase', 'sale'] } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        const avgPrice = await CarbonCredit.aggregate([
            { $match: { isListed: true } },
            { $group: { _id: null, average: { $avg: '$pricePerTonne' } } }
        ]);

        res.json({
            success: true,
            data: {
                totalCredits,
                listedCredits,
                verifiedCredits,
                totalVolume: totalVolume[0]?.total || 0,
                averagePrice: avgPrice[0]?.average || 0,
                recentTransactions
            }
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch market analytics',
            details: error.message
        });
    }
});

module.exports = router;
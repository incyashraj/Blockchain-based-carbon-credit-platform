const express = require('express');
const { body, query, validationResult } = require('express-validator');
const CarbonCredit = require('../models/CarbonCredit');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user's portfolio
router.get('/', auth, [
    query('includeHistory').optional().isBoolean()
], async (req, res) => {
    try {
        const { includeHistory = false } = req.query;

        // Get user's credits
        const credits = await CarbonCredit
            .find({ owner: req.user.id })
            .populate('projectId', 'name projectType location methodology')
            .sort({ createdAt: -1 });

        // Calculate portfolio summary
        const totalCredits = credits.reduce((sum, credit) => sum + credit.quantity, 0);
        const totalValue = credits.reduce((sum, credit) => sum + credit.totalValue, 0);
        const totalCO2Offset = credits.reduce((sum, credit) => {
            if (credit.status === 'Retired') {
                return sum + (credit.metadata?.co2Equivalent || credit.quantity);
            }
            return sum;
        }, 0);

        // Group by status
        const byStatus = credits.reduce((acc, credit) => {
            acc[credit.status] = (acc[credit.status] || 0) + credit.quantity;
            return acc;
        }, {});

        // Group by project type
        const byProjectType = credits.reduce((acc, credit) => {
            const type = credit.projectType || 'Unknown';
            acc[type] = (acc[type] || 0) + credit.quantity;
            return acc;
        }, {});

        let transactionHistory = [];
        if (includeHistory) {
            transactionHistory = await Transaction
                .find({ user: req.user.id })
                .populate('creditId', 'projectName tokenId')
                .populate('projectId', 'name')
                .populate('counterparty', 'firstName lastName organization')
                .sort({ createdAt: -1 })
                .limit(50);
        }

        res.json({
            success: true,
            data: {
                summary: {
                    totalCredits,
                    totalValue,
                    totalCO2Offset,
                    creditsByStatus: byStatus,
                    creditsByType: byProjectType
                },
                credits,
                ...(includeHistory && { transactionHistory })
            }
        });
    } catch (error) {
        console.error('Portfolio error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch portfolio',
            details: error.message
        });
    }
});

// Get transaction history
router.get('/transactions', auth, [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn(['purchase', 'sale', 'retirement', 'transfer', 'mint', 'listing', 'delisting'])
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
            type
        } = req.query;

        let filter = { user: req.user.id };
        if (type) filter.type = type;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const transactions = await Transaction
            .find(filter)
            .populate('creditId', 'projectName tokenId projectType')
            .populate('projectId', 'name')
            .populate('counterparty', 'firstName lastName organization')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(filter);
        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            success: true,
            data: transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('Transaction history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch transaction history',
            details: error.message
        });
    }
});

// Retire carbon credits
router.post('/credits/:creditId/retire', auth, [
    body('quantity').isInt({ min: 1 }),
    body('reason').notEmpty().trim().isLength({ max: 500 })
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

        const { quantity, reason } = req.body;
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
                error: 'You can only retire your own credits'
            });
        }

        // Check availability
        if (credit.quantity < quantity) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient credits available'
            });
        }

        // Check if credit is already retired
        if (credit.status === 'Retired') {
            return res.status(400).json({
                success: false,
                error: 'Credit is already retired'
            });
        }

        // Create retirement transaction
        const transaction = new Transaction({
            type: 'retirement',
            user: req.user.id,
            creditId: creditId,
            projectId: credit.projectId,
            quantity: quantity,
            pricePerTonne: 0, // Retirement has no monetary value
            status: 'completed',
            completedAt: new Date(),
            metadata: { reason },
            blockchainData: {
                transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
                blockNumber: Math.floor(Math.random() * 1000000),
                network: 'polygon'
            }
        });

        await transaction.save();

        // Update credit
        if (credit.quantity === quantity) {
            // Full retirement
            credit.status = 'Retired';
            credit.isListed = false;
            credit.retirementData = {
                retiredDate: new Date(),
                retiredBy: req.user.id,
                reason: reason,
                certificate: `RET-${transaction.transactionId}`
            };
        } else {
            // Partial retirement - create retired credit entry
            const retiredCredit = new CarbonCredit({
                ...credit.toObject(),
                _id: undefined,
                tokenId: credit.tokenId + '_retired_' + Date.now(),
                quantity: quantity,
                status: 'Retired',
                isListed: false,
                retirementData: {
                    retiredDate: new Date(),
                    retiredBy: req.user.id,
                    reason: reason,
                    certificate: `RET-${transaction.transactionId}`
                }
            });
            await retiredCredit.save();

            credit.quantity -= quantity;
        }

        await credit.save();

        res.json({
            success: true,
            message: 'Credits retired successfully',
            data: {
                transactionId: transaction.transactionId,
                certificate: `RET-${transaction.transactionId}`,
                quantity: quantity,
                co2Offset: credit.metadata?.co2Equivalent ? quantity * credit.metadata.co2Equivalent : quantity
            }
        });
    } catch (error) {
        console.error('Retire credits error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retire credits',
            details: error.message
        });
    }
});

// Transfer carbon credits
router.post('/credits/:creditId/transfer', auth, [
    body('quantity').isInt({ min: 1 }),
    body('toAddress').notEmpty().trim(),
    body('notes').optional().trim().isLength({ max: 500 })
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

        const { quantity, toAddress, notes } = req.body;
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
                error: 'You can only transfer your own credits'
            });
        }

        // Check availability
        if (credit.quantity < quantity) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient credits available'
            });
        }

        // In a real implementation, you would validate the toAddress
        // For demo purposes, we'll assume it's valid

        // Create transfer transaction
        const transaction = new Transaction({
            type: 'transfer',
            user: req.user.id,
            creditId: creditId,
            projectId: credit.projectId,
            quantity: quantity,
            pricePerTonne: 0, // Transfer has no monetary value
            status: 'completed',
            completedAt: new Date(),
            metadata: { 
                notes,
                toAddress
            },
            blockchainData: {
                transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
                blockNumber: Math.floor(Math.random() * 1000000),
                network: 'polygon'
            }
        });

        await transaction.save();

        // Update credit quantity
        credit.quantity -= quantity;
        if (credit.quantity === 0) {
            credit.status = 'Transferred';
            credit.isListed = false;
        }

        // Add to transfer history
        credit.transferHistory.push({
            from: req.user.id,
            to: null, // In real implementation, this would be the recipient user ID
            quantity: quantity,
            price: 0,
            transactionHash: transaction.blockchainData.transactionHash
        });

        await credit.save();

        res.json({
            success: true,
            message: 'Credits transferred successfully',
            data: {
                transactionId: transaction.transactionId,
                transactionHash: transaction.blockchainData.transactionHash,
                quantity: quantity,
                toAddress: toAddress
            }
        });
    } catch (error) {
        console.error('Transfer credits error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to transfer credits',
            details: error.message
        });
    }
});

// Get portfolio performance/analytics
router.get('/analytics', auth, async (req, res) => {
    try {
        // Get user's transactions for analytics
        const transactions = await Transaction.find({ user: req.user.id, status: 'completed' });
        
        // Calculate portfolio performance
        const totalInvestment = transactions
            .filter(t => t.type === 'purchase')
            .reduce((sum, t) => sum + t.totalAmount, 0);

        const totalSales = transactions
            .filter(t => t.type === 'sale')
            .reduce((sum, t) => sum + t.totalAmount, 0);

        const totalRetired = transactions
            .filter(t => t.type === 'retirement')
            .reduce((sum, t) => sum + t.quantity, 0);

        // Current holdings value
        const currentCredits = await CarbonCredit.find({ owner: req.user.id, status: 'Active' });
        const currentValue = currentCredits.reduce((sum, credit) => sum + credit.totalValue, 0);

        // Monthly activity
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const recentActivity = await Transaction.aggregate([
            {
                $match: {
                    user: req.user.id,
                    createdAt: { $gte: sixMonthsAgo },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        type: '$type'
                    },
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' },
                    totalQuantity: { $sum: '$quantity' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        res.json({
            success: true,
            data: {
                summary: {
                    totalInvestment,
                    totalSales,
                    currentValue,
                    totalRetired,
                    netPosition: currentValue + totalSales - totalInvestment,
                    roi: totalInvestment > 0 ? ((currentValue + totalSales - totalInvestment) / totalInvestment * 100) : 0
                },
                monthlyActivity: recentActivity,
                transactionSummary: {
                    purchases: transactions.filter(t => t.type === 'purchase').length,
                    sales: transactions.filter(t => t.type === 'sale').length,
                    retirements: transactions.filter(t => t.type === 'retirement').length,
                    transfers: transactions.filter(t => t.type === 'transfer').length
                }
            }
        });
    } catch (error) {
        console.error('Portfolio analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch portfolio analytics',
            details: error.message
        });
    }
});

module.exports = router;
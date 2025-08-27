const express = require('express');
const { query, validationResult } = require('express-validator');
const Project = require('../models/Project');
const CarbonCredit = require('../models/CarbonCredit');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const router = express.Router();

// Get market analytics
router.get('/market', [
    query('timeRange').optional().isIn(['24h', '7d', '30d', '90d', '1y'])
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

        const { timeRange = '30d' } = req.query;

        // Calculate date range
        const now = new Date();
        const timeRanges = {
            '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
            '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
            '90d': new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
            '1y': new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        };
        const startDate = timeRanges[timeRange];

        // Market overview
        const totalMarketCap = await CarbonCredit.aggregate([
            { $match: { status: 'Active' } },
            { $group: { _id: null, total: { $sum: '$totalValue' } } }
        ]);

        const totalVolume24h = await Transaction.aggregate([
            {
                $match: {
                    status: 'completed',
                    type: { $in: ['purchase', 'sale'] },
                    createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
                }
            },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        const totalCreditsTraded = await Transaction.aggregate([
            {
                $match: {
                    status: 'completed',
                    type: { $in: ['purchase', 'sale'] },
                    createdAt: { $gte: startDate }
                }
            },
            { $group: { _id: null, total: { $sum: '$quantity' } } }
        ]);

        const averagePrice = await CarbonCredit.aggregate([
            { $match: { isListed: true, status: 'Active' } },
            { $group: { _id: null, average: { $avg: '$pricePerTonne' } } }
        ]);

        // Price change calculation
        const currentAvgPrice = averagePrice[0]?.average || 0;
        const previousAvgPrice = await CarbonCredit.aggregate([
            {
                $match: {
                    isListed: true,
                    createdAt: { $lte: startDate },
                    status: 'Active'
                }
            },
            { $group: { _id: null, average: { $avg: '$pricePerTonne' } } }
        ]);
        const prevPrice = previousAvgPrice[0]?.average || currentAvgPrice;
        const priceChange24h = prevPrice ? ((currentAvgPrice - prevPrice) / prevPrice * 100) : 0;

        // Volume change
        const previousVolume = await Transaction.aggregate([
            {
                $match: {
                    status: 'completed',
                    type: { $in: ['purchase', 'sale'] },
                    createdAt: {
                        $gte: new Date(now.getTime() - 48 * 60 * 60 * 1000),
                        $lt: new Date(now.getTime() - 24 * 60 * 60 * 1000)
                    }
                }
            },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const prevVolume = previousVolume[0]?.total || 0;
        const currentVolume = totalVolume24h[0]?.total || 0;
        const volumeChange24h = prevVolume ? ((currentVolume - prevVolume) / prevVolume * 100) : 0;

        // Project counts
        const activeProjects = await Project.countDocuments({ status: 'Active' });
        const verifiedProjects = await Project.countDocuments({ verificationStatus: 'Verified' });

        res.json({
            success: true,
            data: {
                totalMarketCap: totalMarketCap[0]?.total || 0,
                totalVolume24h: currentVolume,
                totalCreditsTraded: totalCreditsTraded[0]?.total || 0,
                averagePrice: currentAvgPrice,
                priceChange24h: priceChange24h,
                volumeChange24h: volumeChange24h,
                activeProjects,
                verifiedProjects
            }
        });
    } catch (error) {
        console.error('Market analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch market analytics',
            details: error.message
        });
    }
});

// Get project type analytics
router.get('/project-types', async (req, res) => {
    try {
        const projectTypeStats = await Project.aggregate([
            {
                $group: {
                    _id: '$projectType',
                    count: { $sum: 1 },
                    totalCO2Reduction: { $sum: '$expectedCO2Reduction' },
                    totalCredits: { $sum: '$totalCredits' },
                    avgCO2Reduction: { $avg: '$expectedCO2Reduction' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        // Get credits by project type
        const creditsByType = await CarbonCredit.aggregate([
            {
                $group: {
                    _id: '$projectType',
                    totalQuantity: { $sum: '$quantity' },
                    totalValue: { $sum: '$totalValue' },
                    averagePrice: { $avg: '$pricePerTonne' },
                    activeListings: {
                        $sum: { $cond: ['$isListed', 1, 0] }
                    }
                }
            },
            { $sort: { totalValue: -1 } }
        ]);

        // Merge project and credit data
        const combined = projectTypeStats.map(project => {
            const credits = creditsByType.find(c => c._id === project._id) || {};
            return {
                projectType: project._id,
                projects: {
                    count: project.count,
                    totalCO2Reduction: project.totalCO2Reduction,
                    totalCredits: project.totalCredits,
                    avgCO2Reduction: project.avgCO2Reduction
                },
                credits: {
                    totalQuantity: credits.totalQuantity || 0,
                    totalValue: credits.totalValue || 0,
                    averagePrice: credits.averagePrice || 0,
                    activeListings: credits.activeListings || 0
                }
            };
        });

        res.json({
            success: true,
            data: combined
        });
    } catch (error) {
        console.error('Project type analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch project type analytics',
            details: error.message
        });
    }
});

// Get regional analytics
router.get('/regional', async (req, res) => {
    try {
        const regionalStats = await Project.aggregate([
            {
                $group: {
                    _id: {
                        country: '$location.country',
                        region: '$location.region'
                    },
                    projectCount: { $sum: 1 },
                    totalCO2Reduction: { $sum: '$expectedCO2Reduction' },
                    totalCredits: { $sum: '$totalCredits' },
                    projectTypes: { $addToSet: '$projectType' }
                }
            },
            {
                $group: {
                    _id: '$_id.country',
                    regions: {
                        $push: {
                            region: '$_id.region',
                            projectCount: '$projectCount',
                            totalCO2Reduction: '$totalCO2Reduction',
                            totalCredits: '$totalCredits',
                            projectTypes: '$projectTypes'
                        }
                    },
                    totalProjects: { $sum: '$projectCount' },
                    totalCO2: { $sum: '$totalCO2Reduction' },
                    totalCredits: { $sum: '$totalCredits' }
                }
            },
            { $sort: { totalProjects: -1 } }
        ]);

        // Get credit trading data by region
        const creditsByRegion = await CarbonCredit.aggregate([
            {
                $group: {
                    _id: '$location',
                    totalQuantity: { $sum: '$quantity' },
                    totalValue: { $sum: '$totalValue' },
                    averagePrice: { $avg: '$pricePerTonne' },
                    activeListings: {
                        $sum: { $cond: ['$isListed', 1, 0] }
                    }
                }
            },
            { $sort: { totalValue: -1 } }
        ]);

        res.json({
            success: true,
            data: {
                byCountry: regionalStats,
                creditsByRegion: creditsByRegion
            }
        });
    } catch (error) {
        console.error('Regional analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch regional analytics',
            details: error.message
        });
    }
});

// Get price history
router.get('/price-history', [
    query('timeRange').optional().isIn(['7d', '30d', '90d', '1y']),
    query('projectType').optional().isString()
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

        const { timeRange = '30d', projectType } = req.query;

        // Calculate date range and interval
        const now = new Date();
        const timeRanges = {
            '7d': { 
                start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
                interval: 'day'
            },
            '30d': { 
                start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
                interval: 'day'
            },
            '90d': { 
                start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
                interval: 'week'
            },
            '1y': { 
                start: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
                interval: 'month'
            }
        };

        const { start, interval } = timeRanges[timeRange];

        // Build aggregation pipeline
        let matchStage = {
            status: 'completed',
            type: { $in: ['purchase', 'sale'] },
            createdAt: { $gte: start }
        };

        // Get transaction-based price history
        const priceHistory = await Transaction.aggregate([
            { $match: matchStage },
            ...(projectType ? [
                {
                    $lookup: {
                        from: 'carboncredits',
                        localField: 'creditId',
                        foreignField: '_id',
                        as: 'credit'
                    }
                },
                { $unwind: '$credit' },
                { $match: { 'credit.projectType': projectType } }
            ] : []),
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        ...(interval === 'day' && { day: { $dayOfMonth: '$createdAt' } }),
                        ...(interval === 'week' && { week: { $week: '$createdAt' } })
                    },
                    averagePrice: { $avg: '$pricePerTonne' },
                    volume: { $sum: '$totalAmount' },
                    transactions: { $sum: 1 },
                    minPrice: { $min: '$pricePerTonne' },
                    maxPrice: { $max: '$pricePerTonne' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
        ]);

        // Also get current listed prices for reference
        let currentPriceFilter = { isListed: true, status: 'Active' };
        if (projectType) {
            currentPriceFilter.projectType = projectType;
        }

        const currentPrice = await CarbonCredit.aggregate([
            { $match: currentPriceFilter },
            {
                $group: {
                    _id: null,
                    averagePrice: { $avg: '$pricePerTonne' },
                    minPrice: { $min: '$pricePerTonne' },
                    maxPrice: { $max: '$pricePerTonne' },
                    totalListings: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                priceHistory,
                currentMarket: currentPrice[0] || {
                    averagePrice: 0,
                    minPrice: 0,
                    maxPrice: 0,
                    totalListings: 0
                }
            }
        });
    } catch (error) {
        console.error('Price history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch price history',
            details: error.message
        });
    }
});

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
    try {
        // Key metrics
        const totalProjects = await Project.countDocuments();
        const activeProjects = await Project.countDocuments({ status: 'Active' });
        const totalCredits = await CarbonCredit.aggregate([
            { $group: { _id: null, total: { $sum: '$quantity' } } }
        ]);
        const totalUsers = await User.countDocuments();

        // Recent activity (last 24h)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentTransactions = await Transaction.countDocuments({
            createdAt: { $gte: oneDayAgo },
            status: 'completed'
        });

        const recentVolume = await Transaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: oneDayAgo },
                    status: 'completed',
                    type: { $in: ['purchase', 'sale'] }
                }
            },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        // Top projects by credits issued
        const topProjects = await CarbonCredit.aggregate([
            {
                $group: {
                    _id: '$projectId',
                    totalCredits: { $sum: '$quantity' },
                    totalValue: { $sum: '$totalValue' },
                    projectName: { $first: '$projectName' },
                    projectType: { $first: '$projectType' }
                }
            },
            { $sort: { totalCredits: -1 } },
            { $limit: 5 }
        ]);

        // Market trends (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const weeklyTrends = await Transaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: sevenDaysAgo },
                    status: 'completed',
                    type: { $in: ['purchase', 'sale'] }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    volume: { $sum: '$totalAmount' },
                    transactions: { $sum: 1 },
                    avgPrice: { $avg: '$pricePerTonne' }
                }
            },
            { $sort: { '_id': 1 } }
        ]);

        res.json({
            success: true,
            data: {
                overview: {
                    totalProjects,
                    activeProjects,
                    totalCredits: totalCredits[0]?.total || 0,
                    totalUsers,
                    recentTransactions,
                    recentVolume: recentVolume[0]?.total || 0
                },
                topProjects,
                weeklyTrends
            }
        });
    } catch (error) {
        console.error('Dashboard analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard analytics',
            details: error.message
        });
    }
});

module.exports = router;
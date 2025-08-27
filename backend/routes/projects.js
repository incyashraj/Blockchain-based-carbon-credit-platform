const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Project = require('../models/Project');
const CarbonCredit = require('../models/CarbonCredit');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get all projects with filters and pagination
router.get('/', [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['Draft', 'Under Review', 'Verified', 'Active', 'Completed', 'Rejected']),
    query('projectType').optional().isString(),
    query('search').optional().isString(),
    query('developer').optional().isMongoId()
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
            status,
            projectType,
            search,
            developer
        } = req.query;

        // Build filter
        let filter = {};
        if (status) filter.status = status;
        if (projectType) filter.projectType = projectType;
        if (developer) filter.developer = developer;

        if (search) {
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { description: new RegExp(search, 'i') },
                { 'location.country': new RegExp(search, 'i') },
                { 'location.region': new RegExp(search, 'i') }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const projects = await Project
            .find(filter)
            .populate('developer', 'firstName lastName organization')
            .populate('verifier', 'firstName lastName organization')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Project.countDocuments(filter);
        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            success: true,
            data: projects,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch projects',
            details: error.message
        });
    }
});

// Get single project
router.get('/:projectId', async (req, res) => {
    try {
        const project = await Project
            .findById(req.params.projectId)
            .populate('developer', 'firstName lastName organization email')
            .populate('verifier', 'firstName lastName organization email');

        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Get associated credits
        const credits = await CarbonCredit
            .find({ projectId: project._id })
            .select('tokenId quantity status pricePerTonne totalValue');

        res.json({
            success: true,
            data: {
                ...project.toObject(),
                credits
            }
        });
    } catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch project',
            details: error.message
        });
    }
});

// Create new project
router.post('/', auth, [
    body('name').notEmpty().trim().isLength({ max: 200 }),
    body('description').notEmpty().trim().isLength({ max: 2000 }),
    body('projectType').isIn([
        'renewable-energy', 'forest-conservation', 'reforestation',
        'energy-efficiency', 'waste-management', 'agriculture',
        'blue-carbon', 'direct-air-capture', 'other'
    ]),
    body('methodology').isIn(['VCS', 'CDM', 'Gold Standard', 'CAR', 'ACR', 'Plan Vivo', 'Other']),
    body('location.country').notEmpty(),
    body('location.region').notEmpty(),
    body('timeline.startDate').isISO8601(),
    body('timeline.endDate').isISO8601(),
    body('expectedCO2Reduction').isFloat({ min: 0 }),
    body('totalCredits').isInt({ min: 0 }),
    body('sdgGoals').optional().isArray()
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

        const projectData = {
            ...req.body,
            developer: req.user.id
        };

        // Validate dates
        const startDate = new Date(req.body.timeline.startDate);
        const endDate = new Date(req.body.timeline.endDate);
        
        if (endDate <= startDate) {
            return res.status(400).json({
                success: false,
                error: 'End date must be after start date'
            });
        }

        const project = new Project(projectData);
        await project.save();

        await project.populate('developer', 'firstName lastName organization');

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            data: project
        });
    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create project',
            details: error.message
        });
    }
});

// Update project
router.put('/:projectId', auth, [
    body('name').optional().trim().isLength({ max: 200 }),
    body('description').optional().trim().isLength({ max: 2000 }),
    body('projectType').optional().isIn([
        'renewable-energy', 'forest-conservation', 'reforestation',
        'energy-efficiency', 'waste-management', 'agriculture',
        'blue-carbon', 'direct-air-capture', 'other'
    ]),
    body('methodology').optional().isIn(['VCS', 'CDM', 'Gold Standard', 'CAR', 'ACR', 'Plan Vivo', 'Other']),
    body('expectedCO2Reduction').optional().isFloat({ min: 0 }),
    body('totalCredits').optional().isInt({ min: 0 })
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

        const project = await Project.findById(req.params.projectId);
        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Check ownership or admin permissions
        if (project.developer.toString() !== req.user.id && !req.user.roles?.includes('admin')) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to update this project'
            });
        }

        // Validate date changes if provided
        if (req.body.timeline) {
            const startDate = new Date(req.body.timeline.startDate || project.timeline.startDate);
            const endDate = new Date(req.body.timeline.endDate || project.timeline.endDate);
            
            if (endDate <= startDate) {
                return res.status(400).json({
                    success: false,
                    error: 'End date must be after start date'
                });
            }
        }

        // Update project
        Object.assign(project, req.body);
        await project.save();

        await project.populate('developer', 'firstName lastName organization');

        res.json({
            success: true,
            message: 'Project updated successfully',
            data: project
        });
    } catch (error) {
        console.error('Update project error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update project',
            details: error.message
        });
    }
});

// Delete project
router.delete('/:projectId', auth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.projectId);
        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Check ownership or admin permissions
        if (project.developer.toString() !== req.user.id && !req.user.roles?.includes('admin')) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to delete this project'
            });
        }

        // Check if project has issued credits
        const creditsCount = await CarbonCredit.countDocuments({ projectId: project._id });
        if (creditsCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete project with issued credits'
            });
        }

        await Project.findByIdAndDelete(req.params.projectId);

        res.json({
            success: true,
            message: 'Project deleted successfully'
        });
    } catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete project',
            details: error.message
        });
    }
});

// Submit project for verification
router.post('/:projectId/submit-verification', auth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.projectId);
        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Check ownership
        if (project.developer.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to submit this project'
            });
        }

        if (project.status === 'Under Review') {
            return res.status(400).json({
                success: false,
                error: 'Project is already under review'
            });
        }

        project.status = 'Under Review';
        project.verificationStatus = 'In Progress';
        await project.save();

        res.json({
            success: true,
            message: 'Project submitted for verification successfully',
            data: project
        });
    } catch (error) {
        console.error('Submit verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit project for verification',
            details: error.message
        });
    }
});

// Get project statistics
router.get('/:projectId/stats', async (req, res) => {
    try {
        const project = await Project.findById(req.params.projectId);
        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        // Get credit statistics
        const creditStats = await CarbonCredit.aggregate([
            { $match: { projectId: project._id } },
            {
                $group: {
                    _id: null,
                    totalCredits: { $sum: '$quantity' },
                    activeCredits: {
                        $sum: { $cond: [{ $eq: ['$status', 'Active'] }, '$quantity', 0] }
                    },
                    retiredCredits: {
                        $sum: { $cond: [{ $eq: ['$status', 'Retired'] }, '$quantity', 0] }
                    },
                    listedCredits: {
                        $sum: { $cond: ['$isListed', '$quantity', 0] }
                    },
                    totalValue: { $sum: '$totalValue' },
                    avgPrice: { $avg: '$pricePerTonne' }
                }
            }
        ]);

        const stats = creditStats[0] || {
            totalCredits: 0,
            activeCredits: 0,
            retiredCredits: 0,
            listedCredits: 0,
            totalValue: 0,
            avgPrice: 0
        };

        res.json({
            success: true,
            data: {
                project: {
                    name: project.name,
                    status: project.status,
                    verificationStatus: project.verificationStatus,
                    expectedCO2Reduction: project.expectedCO2Reduction,
                    actualCO2Reduction: project.actualCO2Reduction
                },
                credits: stats
            }
        });
    } catch (error) {
        console.error('Project stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch project statistics',
            details: error.message
        });
    }
});

module.exports = router;
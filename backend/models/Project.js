const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        required: true,
        maxlength: 2000
    },
    projectType: {
        type: String,
        required: true,
        enum: [
            'renewable-energy',
            'forest-conservation', 
            'reforestation',
            'energy-efficiency',
            'waste-management',
            'agriculture',
            'blue-carbon',
            'direct-air-capture',
            'other'
        ]
    },
    methodology: {
        type: String,
        required: true,
        enum: [
            'VCS',
            'CDM', 
            'Gold Standard',
            'CAR',
            'ACR',
            'Plan Vivo',
            'Other'
        ]
    },
    location: {
        country: {
            type: String,
            required: true
        },
        region: {
            type: String,
            required: true
        },
        coordinates: {
            latitude: Number,
            longitude: Number
        }
    },
    timeline: {
        startDate: {
            type: Date,
            required: true
        },
        endDate: {
            type: Date,
            required: true
        },
        creditsIssuanceDate: Date
    },
    expectedCO2Reduction: {
        type: Number,
        required: true,
        min: 0
    },
    actualCO2Reduction: {
        type: Number,
        min: 0,
        default: 0
    },
    totalCredits: {
        type: Number,
        required: true,
        min: 0
    },
    issuedCredits: {
        type: Number,
        default: 0,
        min: 0
    },
    soldCredits: {
        type: Number,
        default: 0,
        min: 0
    },
    status: {
        type: String,
        enum: ['Draft', 'Under Review', 'Verified', 'Active', 'Completed', 'Rejected'],
        default: 'Draft'
    },
    verificationStatus: {
        type: String,
        enum: ['Pending', 'In Progress', 'Verified', 'Failed'],
        default: 'Pending'
    },
    developer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    verifier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    sdgGoals: [{
        type: Number,
        min: 1,
        max: 17
    }],
    documents: [{
        name: String,
        url: String,
        type: {
            type: String,
            enum: ['PDD', 'Monitoring Report', 'Verification Report', 'Certificate', 'Other']
        },
        uploadDate: {
            type: Date,
            default: Date.now
        }
    }],
    imageUrl: String,
    
    // Blockchain integration
    tokenId: String,
    contractAddress: String,
    transactionHash: String,
    
    // Financial data
    pricePerTonne: Number,
    totalValue: Number,
    
    // Audit trail
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update the updatedAt field on save
projectSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Indexes for performance
projectSchema.index({ status: 1 });
projectSchema.index({ verificationStatus: 1 });
projectSchema.index({ projectType: 1 });
projectSchema.index({ 'location.country': 1 });
projectSchema.index({ developer: 1 });
projectSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Project', projectSchema);
const mongoose = require('mongoose');

const carbonCreditSchema = new mongoose.Schema({
    tokenId: {
        type: String,
        required: true,
        unique: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    projectName: {
        type: String,
        required: true
    },
    projectType: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    vintage: {
        type: String,
        required: true
    },
    methodology: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 0
    },
    pricePerTonne: {
        type: Number,
        required: true,
        min: 0
    },
    totalValue: {
        type: Number,
        required: true,
        min: 0
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    originalIssuer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['Active', 'Retired', 'Listed', 'Sold', 'Transferred'],
        default: 'Active'
    },
    verificationStatus: {
        type: String,
        enum: ['Verified', 'Pending', 'Failed'],
        default: 'Pending'
    },
    serialNumbers: [{
        type: String
    }],
    
    // Blockchain data
    contractAddress: String,
    transactionHash: String,
    blockNumber: Number,
    
    // Marketplace data
    isListed: {
        type: Boolean,
        default: false
    },
    listingId: String,
    
    // Retirement data
    retirementData: {
        retiredDate: Date,
        retiredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        reason: String,
        certificate: String
    },
    
    // Transfer history
    transferHistory: [{
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        to: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        quantity: Number,
        price: Number,
        date: {
            type: Date,
            default: Date.now
        },
        transactionHash: String
    }],
    
    // Verification documents
    verificationDocuments: [{
        name: String,
        url: String,
        hash: String,
        uploadDate: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Metadata
    metadata: {
        co2Equivalent: Number,
        issuanceDate: Date,
        expirationDate: Date,
        additionalCertifications: [String],
        sdgImpacts: [Number],
        cobenefits: [String]
    },
    
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
carbonCreditSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Calculate total value before saving
carbonCreditSchema.pre('save', function(next) {
    this.totalValue = this.quantity * this.pricePerTonne;
    next();
});

// Indexes for performance
carbonCreditSchema.index({ tokenId: 1 });
carbonCreditSchema.index({ projectId: 1 });
carbonCreditSchema.index({ owner: 1 });
carbonCreditSchema.index({ status: 1 });
carbonCreditSchema.index({ verificationStatus: 1 });
carbonCreditSchema.index({ projectType: 1 });
carbonCreditSchema.index({ vintage: 1 });
carbonCreditSchema.index({ isListed: 1 });
carbonCreditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CarbonCredit', carbonCreditSchema);
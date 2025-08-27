const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            'purchase',
            'sale', 
            'retirement',
            'transfer',
            'mint',
            'listing',
            'delisting'
        ]
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    counterparty: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    creditId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CarbonCredit',
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
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
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'USD'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    
    // Blockchain data
    blockchainData: {
        transactionHash: String,
        blockNumber: Number,
        gasUsed: Number,
        gasPrice: String,
        network: String
    },
    
    // Payment data
    paymentData: {
        method: {
            type: String,
            enum: ['crypto', 'bank_transfer', 'credit_card', 'other']
        },
        paymentId: String,
        paymentStatus: {
            type: String,
            enum: ['pending', 'completed', 'failed']
        }
    },
    
    // Metadata
    metadata: {
        reason: String,
        notes: String,
        certificateUrl: String
    },
    
    // Timestamps
    initiatedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Calculate total amount before saving
transactionSchema.pre('save', function(next) {
    this.totalAmount = this.quantity * this.pricePerTonne;
    next();
});

// Generate transaction ID if not provided
transactionSchema.pre('save', function(next) {
    if (!this.transactionId) {
        this.transactionId = 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    next();
});

// Indexes
transactionSchema.index({ user: 1 });
transactionSchema.index({ creditId: 1 });
transactionSchema.index({ projectId: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ 'blockchainData.transactionHash': 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
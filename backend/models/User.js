const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    lastName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    organizationType: {
        type: String,
        required: true,
        enum: ['individual', 'company', 'ngo', 'government'],
        default: 'individual'
    },
    organization: {
        type: String,
        trim: true,
        maxlength: 100,
        default: null
    },
    walletAddress: {
        type: String,
        trim: true,
        lowercase: true,
        match: [/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum wallet address'],
        default: null
    },
    profile: {
        isVerified: {
            type: Boolean,
            default: false
        },
        walletVerified: {
            type: Boolean,
            default: false
        },
        kycStatus: {
            type: String,
            enum: ['pending', 'verified', 'rejected'],
            default: 'pending'
        },
        carbonCreditsOwned: {
            type: Number,
            default: 0,
            min: 0
        },
        carbonCreditsRetired: {
            type: Number,
            default: 0,
            min: 0
        },
        totalTransactions: {
            type: Number,
            default: 0,
            min: 0
        },
        reputationScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        }
    },
    preferences: {
        notifications: {
            email: {
                type: Boolean,
                default: true
            },
            browser: {
                type: Boolean,
                default: true
            },
            transactions: {
                type: Boolean,
                default: true
            },
            marketplace: {
                type: Boolean,
                default: true
            },
            verification: {
                type: Boolean,
                default: true
            }
        },
        privacy: {
            showProfile: {
                type: Boolean,
                default: false
            },
            showTransactions: {
                type: Boolean,
                default: false
            }
        },
        dashboard: {
            defaultView: {
                type: String,
                enum: ['overview', 'projects', 'marketplace', 'portfolio'],
                default: 'overview'
            },
            currency: {
                type: String,
                enum: ['USD', 'EUR', 'ETH', 'BTC'],
                default: 'USD'
            }
        }
    },
    roles: [{
        type: String,
        enum: ['user', 'verifier', 'admin', 'project_developer', 'broker'],
        default: 'user'
    }],
    permissions: [{
        type: String,
        enum: [
            'read_projects',
            'create_projects', 
            'verify_credits',
            'approve_projects',
            'manage_marketplace',
            'access_analytics',
            'admin_panel'
        ]
    }],
    apiKeys: [{
        name: {
            type: String,
            required: true
        },
        key: {
            type: String,
            required: true,
            unique: true
        },
        permissions: [String],
        isActive: {
            type: Boolean,
            default: true
        },
        lastUsed: Date,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    loginHistory: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        ipAddress: String,
        userAgent: String,
        location: {
            country: String,
            city: String
        }
    }],
    activityLog: [{
        action: {
            type: String,
            required: true
        },
        details: mongoose.Schema.Types.Mixed,
        timestamp: {
            type: Date,
            default: Date.now
        },
        ipAddress: String
    }],
    lastLogin: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    emailVerificationToken: String,
    passwordResetToken: String,
    passwordResetExpires: Date
}, {
    timestamps: true,
    toJSON: {
        transform: function(doc, ret) {
            // Remove sensitive data when converting to JSON
            delete ret.password;
            delete ret.emailVerificationToken;
            delete ret.passwordResetToken;
            delete ret.passwordResetExpires;
            return ret;
        }
    }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ walletAddress: 1 });
userSchema.index({ 'profile.isVerified': 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastLogin: -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

// Method to check if user has permission
userSchema.methods.hasPermission = function(permission) {
    return this.permissions.includes(permission) || this.roles.includes('admin');
};

// Method to check if user has role
userSchema.methods.hasRole = function(role) {
    return this.roles.includes(role);
};

// Method to log user activity
userSchema.methods.logActivity = function(action, details = {}, ipAddress = null) {
    this.activityLog.push({
        action,
        details,
        ipAddress,
        timestamp: new Date()
    });
    
    // Keep only last 100 activities
    if (this.activityLog.length > 100) {
        this.activityLog = this.activityLog.slice(-100);
    }
    
    return this.save();
};

// Method to update user statistics
userSchema.methods.updateStats = function(statsUpdate) {
    if (statsUpdate.creditsOwned !== undefined) {
        this.profile.carbonCreditsOwned = Math.max(0, statsUpdate.creditsOwned);
    }
    if (statsUpdate.creditsRetired !== undefined) {
        this.profile.carbonCreditsRetired += statsUpdate.creditsRetired;
    }
    if (statsUpdate.transactionCount !== undefined) {
        this.profile.totalTransactions += statsUpdate.transactionCount;
    }
    
    return this.save();
};

// Static method to find users by role
userSchema.statics.findByRole = function(role) {
    return this.find({ roles: role, isActive: true });
};

// Static method to find verified users
userSchema.statics.findVerified = function() {
    return this.find({ 'profile.isVerified': true, isActive: true });
};

// Pre-save middleware
userSchema.pre('save', function(next) {
    // Update permissions based on roles
    if (this.isModified('roles')) {
        this.permissions = this.permissions || [];
        
        // Add permissions based on roles
        if (this.roles.includes('admin')) {
            this.permissions = [
                'read_projects', 'create_projects', 'verify_credits',
                'approve_projects', 'manage_marketplace', 'access_analytics', 'admin_panel'
            ];
        } else if (this.roles.includes('verifier')) {
            this.permissions.push('verify_credits', 'read_projects');
        } else if (this.roles.includes('project_developer')) {
            this.permissions.push('create_projects', 'read_projects');
        } else if (this.roles.includes('broker')) {
            this.permissions.push('manage_marketplace', 'read_projects');
        }
        
        // Remove duplicates
        this.permissions = [...new Set(this.permissions)];
    }
    
    next();
});

// Post-save middleware to log user registration
userSchema.post('save', function(doc, next) {
    if (this.isNew) {
        console.log(`New user registered: ${doc.email} (${doc.organizationType})`);
    }
    next();
});

module.exports = mongoose.model('User', userSchema);
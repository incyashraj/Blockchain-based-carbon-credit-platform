const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class IPFSService {
    constructor() {
        // Use Pinata as IPFS gateway
        this.pinataApiKey = process.env.PINATA_API_KEY;
        this.pinataSecretApiKey = process.env.PINATA_SECRET_KEY;
        this.pinataGateway = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
        
        // Fallback to local IPFS node if Pinata not configured
        this.localIpfsUrl = process.env.IPFS_NODE_URL || 'http://127.0.0.1:5001';
        
        // Check configuration
        this.isPinataConfigured = !!(this.pinataApiKey && this.pinataSecretApiKey);
        
        console.log(`IPFS Service initialized: ${this.isPinataConfigured ? 'Pinata' : 'Local IPFS'} mode`);
    }

    /**
     * Upload JSON data to IPFS
     * @param {Object} data - JSON data to upload
     * @param {string} filename - Optional filename
     * @returns {Promise<{hash: string, url: string}>}
     */
    async uploadJSON(data, filename = 'data.json') {
        try {
            const jsonString = JSON.stringify(data, null, 2);
            const buffer = Buffer.from(jsonString);

            if (this.isPinataConfigured) {
                return await this.uploadToPinata(buffer, filename, 'application/json');
            } else {
                return await this.uploadToLocalIPFS(buffer, filename);
            }
        } catch (error) {
            console.error('Failed to upload JSON to IPFS:', error);
            throw new Error(`IPFS upload failed: ${error.message}`);
        }
    }

    /**
     * Upload file buffer to IPFS
     * @param {Buffer} buffer - File buffer
     * @param {string} filename - Filename
     * @param {string} contentType - MIME type
     * @returns {Promise<{hash: string, url: string}>}
     */
    async uploadBuffer(buffer, filename, contentType = 'application/octet-stream') {
        try {
            if (this.isPinataConfigured) {
                return await this.uploadToPinata(buffer, filename, contentType);
            } else {
                return await this.uploadToLocalIPFS(buffer, filename);
            }
        } catch (error) {
            console.error('Failed to upload buffer to IPFS:', error);
            throw new Error(`IPFS upload failed: ${error.message}`);
        }
    }

    /**
     * Upload file to IPFS
     * @param {string} filePath - Path to file
     * @returns {Promise<{hash: string, url: string}>}
     */
    async uploadFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }

            const buffer = fs.readFileSync(filePath);
            const filename = path.basename(filePath);
            const contentType = this.getContentType(filename);

            return await this.uploadBuffer(buffer, filename, contentType);
        } catch (error) {
            console.error('Failed to upload file to IPFS:', error);
            throw new Error(`File upload failed: ${error.message}`);
        }
    }

    /**
     * Upload to Pinata IPFS service
     * @private
     */
    async uploadToPinata(buffer, filename, contentType) {
        try {
            const formData = new FormData();
            formData.append('file', buffer, {
                filename: filename,
                contentType: contentType
            });

            // Add metadata
            const metadata = {
                name: filename,
                keyvalues: {
                    uploadedBy: 'carbon-credits-platform',
                    timestamp: new Date().toISOString(),
                    contentType: contentType,
                    size: buffer.length
                }
            };
            formData.append('pinataMetadata', JSON.stringify(metadata));

            // Add options
            const options = {
                cidVersion: 1,
                customPinPolicy: {
                    regions: [
                        { id: 'FRA1', desiredReplicationCount: 1 },
                        { id: 'NYC1', desiredReplicationCount: 1 }
                    ]
                }
            };
            formData.append('pinataOptions', JSON.stringify(options));

            const response = await axios.post(
                'https://api.pinata.cloud/pinning/pinFileToIPFS',
                formData,
                {
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                        'pinata_api_key': this.pinataApiKey,
                        'pinata_secret_api_key': this.pinataSecretApiKey
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            const hash = response.data.IpfsHash;
            const url = `${this.pinataGateway}${hash}`;

            console.log(`File uploaded to Pinata IPFS: ${hash}`);

            return { hash, url };
        } catch (error) {
            console.error('Pinata upload error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Upload to local IPFS node
     * @private
     */
    async uploadToLocalIPFS(buffer, filename) {
        try {
            const formData = new FormData();
            formData.append('file', buffer, filename);

            const response = await axios.post(
                `${this.localIpfsUrl}/api/v0/add`,
                formData,
                {
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${formData._boundary}`
                    },
                    params: {
                        'cid-version': 1,
                        'hash': 'sha2-256'
                    }
                }
            );

            const hash = response.data.Hash;
            const url = `${this.localIpfsUrl}/api/v0/cat?arg=${hash}`;

            console.log(`File uploaded to local IPFS: ${hash}`);

            return { hash, url };
        } catch (error) {
            console.error('Local IPFS upload error:', error.message);
            throw error;
        }
    }

    /**
     * Retrieve data from IPFS
     * @param {string} hash - IPFS hash
     * @returns {Promise<any>}
     */
    async getData(hash) {
        try {
            let url;
            
            if (this.isPinataConfigured) {
                url = `${this.pinataGateway}${hash}`;
            } else {
                url = `${this.localIpfsUrl}/api/v0/cat?arg=${hash}`;
            }

            const response = await axios.get(url, {
                timeout: 10000 // 10 second timeout
            });

            return response.data;
        } catch (error) {
            console.error('Failed to retrieve data from IPFS:', error);
            throw new Error(`IPFS retrieval failed: ${error.message}`);
        }
    }

    /**
     * Retrieve JSON data from IPFS
     * @param {string} hash - IPFS hash
     * @returns {Promise<Object>}
     */
    async getJSON(hash) {
        try {
            const data = await this.getData(hash);
            
            // If data is already parsed, return it
            if (typeof data === 'object') {
                return data;
            }

            // Try to parse as JSON
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to retrieve JSON from IPFS:', error);
            throw new Error(`IPFS JSON retrieval failed: ${error.message}`);
        }
    }

    /**
     * Pin existing content to IPFS (Pinata only)
     * @param {string} hash - IPFS hash to pin
     * @param {string} name - Optional name for the pin
     */
    async pinContent(hash, name = null) {
        if (!this.isPinataConfigured) {
            console.warn('Pinning requires Pinata configuration');
            return;
        }

        try {
            const response = await axios.post(
                'https://api.pinata.cloud/pinning/pinByHash',
                {
                    hashToPin: hash,
                    pinataMetadata: {
                        name: name || `Pinned-${hash.substring(0, 8)}`,
                        keyvalues: {
                            pinnedBy: 'carbon-credits-platform',
                            timestamp: new Date().toISOString()
                        }
                    }
                },
                {
                    headers: {
                        'pinata_api_key': this.pinataApiKey,
                        'pinata_secret_api_key': this.pinataSecretApiKey
                    }
                }
            );

            console.log(`Content pinned successfully: ${hash}`);
            return response.data;
        } catch (error) {
            console.error('Failed to pin content:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Unpin content from IPFS (Pinata only)
     * @param {string} hash - IPFS hash to unpin
     */
    async unpinContent(hash) {
        if (!this.isPinataConfigured) {
            console.warn('Unpinning requires Pinata configuration');
            return;
        }

        try {
            const response = await axios.delete(
                `https://api.pinata.cloud/pinning/unpin/${hash}`,
                {
                    headers: {
                        'pinata_api_key': this.pinataApiKey,
                        'pinata_secret_api_key': this.pinataSecretApiKey
                    }
                }
            );

            console.log(`Content unpinned successfully: ${hash}`);
            return response.data;
        } catch (error) {
            console.error('Failed to unpin content:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * List pinned content (Pinata only)
     * @param {Object} options - Query options
     */
    async listPinnedContent(options = {}) {
        if (!this.isPinataConfigured) {
            console.warn('Listing pins requires Pinata configuration');
            return [];
        }

        try {
            const response = await axios.get(
                'https://api.pinata.cloud/data/pinList',
                {
                    headers: {
                        'pinata_api_key': this.pinataApiKey,
                        'pinata_secret_api_key': this.pinataSecretApiKey
                    },
                    params: {
                        pageLimit: options.limit || 100,
                        pageOffset: options.offset || 0,
                        ...options
                    }
                }
            );

            return response.data.rows;
        } catch (error) {
            console.error('Failed to list pinned content:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Generate content hash for verification
     * @param {any} content - Content to hash
     * @returns {string} SHA-256 hash
     */
    generateContentHash(content) {
        const contentString = typeof content === 'string' ? content : JSON.stringify(content);
        return crypto.createHash('sha256').update(contentString).digest('hex');
    }

    /**
     * Verify content integrity
     * @param {any} content - Original content
     * @param {string} expectedHash - Expected hash
     * @returns {boolean}
     */
    verifyContentIntegrity(content, expectedHash) {
        const actualHash = this.generateContentHash(content);
        return actualHash === expectedHash;
    }

    /**
     * Get content type from filename
     * @private
     */
    getContentType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const types = {
            '.json': 'application/json',
            '.pdf': 'application/pdf',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.txt': 'text/plain',
            '.csv': 'text/csv',
            '.xml': 'application/xml',
            '.zip': 'application/zip'
        };
        return types[ext] || 'application/octet-stream';
    }

    /**
     * Upload sensor data with metadata
     * @param {Object} sensorData - Sensor data object
     * @param {string} sensorId - Sensor identifier
     * @returns {Promise<{hash: string, url: string, contentHash: string}>}
     */
    async uploadSensorData(sensorData, sensorId) {
        try {
            // Add metadata
            const enrichedData = {
                ...sensorData,
                ipfsMetadata: {
                    uploadedAt: new Date().toISOString(),
                    sensorId: sensorId,
                    version: '1.0',
                    type: 'sensor-data'
                }
            };

            // Generate content hash for integrity
            const contentHash = this.generateContentHash(enrichedData);
            enrichedData.contentHash = contentHash;

            const filename = `sensor-data-${sensorId}-${Date.now()}.json`;
            const result = await this.uploadJSON(enrichedData, filename);

            return {
                ...result,
                contentHash
            };
        } catch (error) {
            console.error('Failed to upload sensor data:', error);
            throw error;
        }
    }

    /**
     * Upload verification report
     * @param {Object} verificationData - Verification report data
     * @param {string} projectId - Project identifier
     * @returns {Promise<{hash: string, url: string, contentHash: string}>}
     */
    async uploadVerificationReport(verificationData, projectId) {
        try {
            const enrichedData = {
                ...verificationData,
                ipfsMetadata: {
                    uploadedAt: new Date().toISOString(),
                    projectId: projectId,
                    version: '1.0',
                    type: 'verification-report'
                }
            };

            const contentHash = this.generateContentHash(enrichedData);
            enrichedData.contentHash = contentHash;

            const filename = `verification-${projectId}-${Date.now()}.json`;
            const result = await this.uploadJSON(enrichedData, filename);

            return {
                ...result,
                contentHash
            };
        } catch (error) {
            console.error('Failed to upload verification report:', error);
            throw error;
        }
    }

    /**
     * Test IPFS connectivity
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const testData = {
                test: true,
                timestamp: new Date().toISOString(),
                message: 'IPFS connectivity test'
            };

            const result = await this.uploadJSON(testData, 'connectivity-test.json');
            const retrievedData = await this.getJSON(result.hash);

            const isValid = this.verifyContentIntegrity(retrievedData, this.generateContentHash(testData));
            
            console.log(`IPFS connectivity test ${isValid ? 'passed' : 'failed'}`);
            return isValid;
        } catch (error) {
            console.error('IPFS connectivity test failed:', error);
            return false;
        }
    }

    /**
     * Get service status
     * @returns {Object}
     */
    getStatus() {
        return {
            configured: this.isPinataConfigured,
            service: this.isPinataConfigured ? 'Pinata' : 'Local IPFS',
            gateway: this.pinataGateway,
            localNode: this.localIpfsUrl
        };
    }
}

module.exports = IPFSService;
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface ICarbonCreditToken {
    function mintCarbonCredit(
        string memory projectId,
        string memory methodology,
        uint256 co2Equivalent,
        uint256 expirationDate,
        string memory ipfsHash,
        uint256 amount
    ) external;
    
    function verifyCredit(uint256 tokenId) external;
    function activateCredit(uint256 tokenId) external;
}

contract CarbonOracle is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant AI_VERIFIER_ROLE = keccak256("AI_VERIFIER_ROLE");
    bytes32 public constant IOT_PROVIDER_ROLE = keccak256("IOT_PROVIDER_ROLE");
    
    ICarbonCreditToken public carbonToken;
    
    struct EmissionData {
        string sensorId;
        uint256 timestamp;
        uint256 co2Reading; // in ppm
        uint256 location; // encoded lat/long
        string dataHash; // hash of raw sensor data
        bool verified;
        address provider;
    }
    
    struct VerificationRequest {
        uint256 requestId;
        string projectId;
        uint256[] emissionDataIds;
        string methodology;
        uint256 co2Equivalent;
        uint256 requestTime;
        VerificationStatus status;
        address requester;
        string ipfsHash;
        uint256 aiScore; // AI verification score (0-100)
        string aiAnalysisHash;
    }
    
    enum VerificationStatus {
        PENDING,
        AI_VERIFIED,
        HUMAN_VERIFIED,
        REJECTED,
        COMPLETED
    }
    
    mapping(uint256 => EmissionData) public emissionData;
    mapping(uint256 => VerificationRequest) public verificationRequests;
    mapping(string => uint256) public projectRequests; // projectId => requestId
    mapping(address => uint256[]) public providerData;
    
    uint256 private _emissionDataCounter;
    uint256 private _requestCounter;
    
    // AI verification thresholds
    uint256 public constant AI_THRESHOLD_HIGH = 90; // Auto-approve above 90%
    uint256 public constant AI_THRESHOLD_LOW = 60;  // Auto-reject below 60%
    
    event EmissionDataSubmitted(
        uint256 indexed dataId,
        string indexed sensorId,
        uint256 co2Reading,
        address indexed provider
    );
    
    event VerificationRequested(
        uint256 indexed requestId,
        string indexed projectId,
        address indexed requester
    );
    
    event AIVerificationCompleted(
        uint256 indexed requestId,
        uint256 aiScore,
        string aiAnalysisHash
    );
    
    event CreditMintingApproved(
        uint256 indexed requestId,
        string indexed projectId,
        uint256 tokenId
    );
    
    event DataVerified(uint256 indexed dataId, address indexed verifier);
    
    constructor(address _carbonTokenAddress) {
        carbonToken = ICarbonCreditToken(_carbonTokenAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }
    
    function submitEmissionData(
        string memory sensorId,
        uint256 co2Reading,
        uint256 location,
        string memory dataHash
    ) external onlyRole(IOT_PROVIDER_ROLE) whenNotPaused returns (uint256) {
        require(bytes(sensorId).length > 0, "Sensor ID required");
        require(co2Reading > 0, "Invalid CO2 reading");
        require(bytes(dataHash).length > 0, "Data hash required");
        
        _emissionDataCounter++;
        uint256 dataId = _emissionDataCounter;
        
        emissionData[dataId] = EmissionData({
            sensorId: sensorId,
            timestamp: block.timestamp,
            co2Reading: co2Reading,
            location: location,
            dataHash: dataHash,
            verified: false,
            provider: msg.sender
        });
        
        providerData[msg.sender].push(dataId);
        
        emit EmissionDataSubmitted(dataId, sensorId, co2Reading, msg.sender);
        
        return dataId;
    }
    
    function requestVerification(
        string memory projectId,
        uint256[] memory emissionDataIds,
        string memory methodology,
        uint256 co2Equivalent,
        string memory ipfsHash
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(bytes(projectId).length > 0, "Project ID required");
        require(emissionDataIds.length > 0, "Emission data required");
        require(co2Equivalent > 0, "CO2 equivalent must be positive");
        require(projectRequests[projectId] == 0, "Project already has pending request");
        
        // Verify all emission data exists and is from verified providers
        for (uint256 i = 0; i < emissionDataIds.length; i++) {
            require(emissionData[emissionDataIds[i]].timestamp > 0, "Invalid emission data");
        }
        
        _requestCounter++;
        uint256 requestId = _requestCounter;
        
        verificationRequests[requestId] = VerificationRequest({
            requestId: requestId,
            projectId: projectId,
            emissionDataIds: emissionDataIds,
            methodology: methodology,
            co2Equivalent: co2Equivalent,
            requestTime: block.timestamp,
            status: VerificationStatus.PENDING,
            requester: msg.sender,
            ipfsHash: ipfsHash,
            aiScore: 0,
            aiAnalysisHash: ""
        });
        
        projectRequests[projectId] = requestId;
        
        emit VerificationRequested(requestId, projectId, msg.sender);
        
        return requestId;
    }
    
    function submitAIVerification(
        uint256 requestId,
        uint256 aiScore,
        string memory aiAnalysisHash
    ) external onlyRole(AI_VERIFIER_ROLE) {
        require(requestId <= _requestCounter, "Invalid request ID");
        VerificationRequest storage request = verificationRequests[requestId];
        require(request.status == VerificationStatus.PENDING, "Request not pending");
        require(aiScore <= 100, "Invalid AI score");
        require(bytes(aiAnalysisHash).length > 0, "AI analysis hash required");
        
        request.aiScore = aiScore;
        request.aiAnalysisHash = aiAnalysisHash;
        request.status = VerificationStatus.AI_VERIFIED;
        
        emit AIVerificationCompleted(requestId, aiScore, aiAnalysisHash);
        
        // Auto-process based on AI score
        if (aiScore >= AI_THRESHOLD_HIGH) {
            _approveAndMintCredit(requestId);
        } else if (aiScore < AI_THRESHOLD_LOW) {
            request.status = VerificationStatus.REJECTED;
        }
        // Scores between 60-90% require human verification
    }
    
    function humanVerifyRequest(
        uint256 requestId,
        bool approved
    ) external onlyRole(ORACLE_ROLE) {
        require(requestId <= _requestCounter, "Invalid request ID");
        VerificationRequest storage request = verificationRequests[requestId];
        require(
            request.status == VerificationStatus.AI_VERIFIED || 
            request.status == VerificationStatus.PENDING,
            "Invalid status for human verification"
        );
        
        if (approved) {
            _approveAndMintCredit(requestId);
        } else {
            request.status = VerificationStatus.REJECTED;
        }
    }
    
    function _approveAndMintCredit(uint256 requestId) internal {
        VerificationRequest storage request = verificationRequests[requestId];
        
        // Calculate credit amount based on CO2 equivalent (1 credit = 1 ton CO2)
        uint256 creditAmount = request.co2Equivalent;
        
        // Set expiration to 10 years from now (standard for carbon credits)
        uint256 expirationDate = block.timestamp + (10 * 365 days);
        
        // Mint the carbon credit token
        carbonToken.mintCarbonCredit(
            request.projectId,
            request.methodology,
            request.co2Equivalent,
            expirationDate,
            request.ipfsHash,
            creditAmount
        );
        
        request.status = VerificationStatus.COMPLETED;
        
        // Note: We can't get the token ID from the mint function directly
        // The frontend/backend will need to listen for the CreditMinted event
        // to get the actual token ID for further operations
        
        emit CreditMintingApproved(requestId, request.projectId, 0); // tokenId will be available in CreditMinted event
    }
    
    function verifyEmissionData(uint256 dataId) external onlyRole(ORACLE_ROLE) {
        require(dataId <= _emissionDataCounter, "Invalid data ID");
        require(!emissionData[dataId].verified, "Data already verified");
        
        emissionData[dataId].verified = true;
        
        emit DataVerified(dataId, msg.sender);
    }
    
    function getVerificationRequest(uint256 requestId) 
        external 
        view 
        returns (VerificationRequest memory) 
    {
        require(requestId <= _requestCounter, "Invalid request ID");
        return verificationRequests[requestId];
    }
    
    function getEmissionData(uint256 dataId) 
        external 
        view 
        returns (EmissionData memory) 
    {
        require(dataId <= _emissionDataCounter, "Invalid data ID");
        return emissionData[dataId];
    }
    
    function getPendingRequests() external view returns (uint256[] memory) {
        uint256[] memory pendingIds = new uint256[](_requestCounter);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= _requestCounter; i++) {
            if (verificationRequests[i].status == VerificationStatus.PENDING ||
                verificationRequests[i].status == VerificationStatus.AI_VERIFIED) {
                pendingIds[count] = i;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = pendingIds[i];
        }
        
        return result;
    }
    
    function getProviderData(address provider) external view returns (uint256[] memory) {
        return providerData[provider];
    }
    
    function updateCarbonTokenAddress(address _carbonTokenAddress) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(_carbonTokenAddress != address(0), "Invalid address");
        carbonToken = ICarbonCreditToken(_carbonTokenAddress);
    }
    
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
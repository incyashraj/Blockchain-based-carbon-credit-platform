// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract CarbonCreditToken is ERC1155, AccessControl, ReentrancyGuard, Pausable {
    using Counters for Counters.Counter;
    
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    Counters.Counter private _tokenIds;
    
    struct CarbonCredit {
        uint256 tokenId;
        uint256 totalSupply;
        uint256 availableSupply;
        string projectId;
        string methodology;
        uint256 co2Equivalent; // in tons
        uint256 issuanceDate;
        uint256 expirationDate;
        string ipfsHash; // MRV data stored on IPFS
        bool verified;
        address issuer;
        CreditStatus status;
    }
    
    enum CreditStatus {
        PENDING,
        VERIFIED,
        ACTIVE,
        RETIRED,
        CANCELLED
    }
    
    mapping(uint256 => CarbonCredit) public carbonCredits;
    mapping(string => uint256) public projectToTokenId;
    mapping(address => uint256[]) public userCredits;
    
    event CreditMinted(
        uint256 indexed tokenId,
        string indexed projectId,
        uint256 co2Equivalent,
        address indexed issuer
    );
    
    event CreditVerified(uint256 indexed tokenId, address indexed verifier);
    event CreditRetired(uint256 indexed tokenId, uint256 amount, address indexed retiree);
    event CreditTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        uint256 amount
    );
    
    constructor(string memory uri) ERC1155(uri) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }
    
    function mintCarbonCredit(
        string memory projectId,
        string memory methodology,
        uint256 co2Equivalent,
        uint256 expirationDate,
        string memory ipfsHash,
        uint256 amount
    ) public onlyRole(MINTER_ROLE) whenNotPaused {
        require(bytes(projectId).length > 0, "Project ID cannot be empty");
        require(co2Equivalent > 0, "CO2 equivalent must be positive");
        require(expirationDate > block.timestamp, "Expiration date must be in future");
        require(projectToTokenId[projectId] == 0, "Project already exists");
        
        _tokenIds.increment();
        uint256 tokenId = _tokenIds.current();
        
        carbonCredits[tokenId] = CarbonCredit({
            tokenId: tokenId,
            totalSupply: amount,
            availableSupply: amount,
            projectId: projectId,
            methodology: methodology,
            co2Equivalent: co2Equivalent,
            issuanceDate: block.timestamp,
            expirationDate: expirationDate,
            ipfsHash: ipfsHash,
            verified: false,
            issuer: msg.sender,
            status: CreditStatus.PENDING
        });
        
        projectToTokenId[projectId] = tokenId;
        userCredits[msg.sender].push(tokenId);
        
        _mint(msg.sender, tokenId, amount, "");
        
        emit CreditMinted(tokenId, projectId, co2Equivalent, msg.sender);
    }
    
    function verifyCredit(uint256 tokenId) public onlyRole(VERIFIER_ROLE) {
        require(_exists(tokenId), "Token does not exist");
        require(!carbonCredits[tokenId].verified, "Credit already verified");
        require(
            carbonCredits[tokenId].status == CreditStatus.PENDING,
            "Credit not in pending status"
        );
        
        carbonCredits[tokenId].verified = true;
        carbonCredits[tokenId].status = CreditStatus.VERIFIED;
        
        emit CreditVerified(tokenId, msg.sender);
    }
    
    function activateCredit(uint256 tokenId) public onlyRole(VERIFIER_ROLE) {
        require(_exists(tokenId), "Token does not exist");
        require(carbonCredits[tokenId].verified, "Credit not verified");
        require(
            carbonCredits[tokenId].status == CreditStatus.VERIFIED,
            "Credit not in verified status"
        );
        
        carbonCredits[tokenId].status = CreditStatus.ACTIVE;
    }
    
    function retireCredit(uint256 tokenId, uint256 amount) public nonReentrant {
        require(_exists(tokenId), "Token does not exist");
        require(
            carbonCredits[tokenId].status == CreditStatus.ACTIVE,
            "Credit not active"
        );
        require(
            balanceOf(msg.sender, tokenId) >= amount,
            "Insufficient credits to retire"
        );
        require(
            block.timestamp <= carbonCredits[tokenId].expirationDate,
            "Credit has expired"
        );
        
        _burn(msg.sender, tokenId, amount);
        carbonCredits[tokenId].availableSupply -= amount;
        
        if (carbonCredits[tokenId].availableSupply == 0) {
            carbonCredits[tokenId].status = CreditStatus.RETIRED;
        }
        
        emit CreditRetired(tokenId, amount, msg.sender);
    }
    
    function transferCredit(
        address to,
        uint256 tokenId,
        uint256 amount
    ) public {
        require(_exists(tokenId), "Token does not exist");
        require(
            carbonCredits[tokenId].status == CreditStatus.ACTIVE,
            "Credit not active"
        );
        require(to != address(0), "Cannot transfer to zero address");
        
        safeTransferFrom(msg.sender, to, tokenId, amount, "");
        
        emit CreditTransferred(tokenId, msg.sender, to, amount);
    }
    
    function batchTransferCredits(
        address to,
        uint256[] memory tokenIds,
        uint256[] memory amounts
    ) public {
        require(tokenIds.length == amounts.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(_exists(tokenIds[i]), "Token does not exist");
            require(
                carbonCredits[tokenIds[i]].status == CreditStatus.ACTIVE,
                "Credit not active"
            );
        }
        
        safeBatchTransferFrom(msg.sender, to, tokenIds, amounts, "");
    }
    
    function getCreditInfo(uint256 tokenId) public view returns (CarbonCredit memory) {
        require(_exists(tokenId), "Token does not exist");
        return carbonCredits[tokenId];
    }
    
    function getActiveCredits() public view returns (uint256[] memory) {
        uint256[] memory activeTokenIds = new uint256[](_tokenIds.current());
        uint256 count = 0;
        
        for (uint256 i = 1; i <= _tokenIds.current(); i++) {
            if (carbonCredits[i].status == CreditStatus.ACTIVE) {
                activeTokenIds[count] = i;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = activeTokenIds[i];
        }
        
        return result;
    }
    
    function getUserCredits(address user) public view returns (uint256[] memory) {
        return userCredits[user];
    }
    
    function _exists(uint256 tokenId) internal view returns (bool) {
        return carbonCredits[tokenId].tokenId != 0;
    }
    
    function pause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
    
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
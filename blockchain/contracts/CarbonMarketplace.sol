// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

interface ICarbonCreditToken {
    struct CarbonCredit {
        uint256 tokenId;
        uint256 totalSupply;
        uint256 availableSupply;
        string projectId;
        string methodology;
        uint256 co2Equivalent;
        uint256 issuanceDate;
        uint256 expirationDate;
        string ipfsHash;
        bool verified;
        address issuer;
        uint8 status; // CreditStatus enum
    }
    
    function getCreditInfo(uint256 tokenId) external view returns (CarbonCredit memory);
    function transferCredit(address to, uint256 tokenId, uint256 amount) external;
}

contract CarbonMarketplace is ReentrancyGuard, Ownable, Pausable, ERC1155Holder {
    ICarbonCreditToken public carbonToken;
    
    uint256 private constant PLATFORM_FEE_BASIS_POINTS = 250; // 2.5%
    uint256 private constant BASIS_POINTS = 10000;
    
    struct Listing {
        uint256 listingId;
        uint256 tokenId;
        address seller;
        uint256 amount;
        uint256 pricePerCredit; // in wei
        uint256 createdAt;
        uint256 expiresAt;
        bool active;
        ListingType listingType;
    }
    
    struct Auction {
        uint256 auctionId;
        uint256 tokenId;
        address seller;
        uint256 amount;
        uint256 startingPrice;
        uint256 currentBid;
        address currentBidder;
        uint256 startTime;
        uint256 endTime;
        bool active;
        bool finalized;
    }
    
    enum ListingType {
        FIXED_PRICE,
        AUCTION,
        BULK_DISCOUNT
    }
    
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256[]) public userListings;
    mapping(address => uint256[]) public userBids;
    
    uint256 private _listingIdCounter;
    uint256 private _auctionIdCounter;
    uint256 public totalVolume;
    uint256 public totalTransactions;
    
    event ListingCreated(
        uint256 indexed listingId,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 amount,
        uint256 pricePerCredit
    );
    
    event ListingPurchased(
        uint256 indexed listingId,
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 amount,
        uint256 totalPrice
    );
    
    event AuctionCreated(
        uint256 indexed auctionId,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 amount,
        uint256 startingPrice,
        uint256 endTime
    );
    
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 bidAmount
    );
    
    event AuctionFinalized(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 winningBid
    );
    
    event ListingCancelled(uint256 indexed listingId);
    
    constructor(address _carbonTokenAddress) {
        carbonToken = ICarbonCreditToken(_carbonTokenAddress);
    }
    
    function createListing(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerCredit,
        uint256 duration
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");
        require(pricePerCredit > 0, "Price must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        
        ICarbonCreditToken.CarbonCredit memory credit = carbonToken.getCreditInfo(tokenId);
        require(credit.status == 2, "Credit not active"); // ACTIVE status
        require(
            IERC1155(address(carbonToken)).balanceOf(msg.sender, tokenId) >= amount,
            "Insufficient token balance"
        );
        
        _listingIdCounter++;
        uint256 listingId = _listingIdCounter;
        
        listings[listingId] = Listing({
            listingId: listingId,
            tokenId: tokenId,
            seller: msg.sender,
            amount: amount,
            pricePerCredit: pricePerCredit,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            active: true,
            listingType: ListingType.FIXED_PRICE
        });
        
        userListings[msg.sender].push(listingId);
        
        // Transfer tokens to marketplace for escrow
        IERC1155(address(carbonToken)).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId,
            amount,
            ""
        );
        
        emit ListingCreated(listingId, tokenId, msg.sender, amount, pricePerCredit);
    }
    
    function purchaseListing(uint256 listingId, uint256 amount) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.expiresAt > block.timestamp, "Listing expired");
        require(amount > 0 && amount <= listing.amount, "Invalid amount");
        require(msg.sender != listing.seller, "Cannot buy own listing");
        
        uint256 totalPrice = amount * listing.pricePerCredit;
        require(msg.value >= totalPrice, "Insufficient payment");
        
        // Calculate platform fee
        uint256 platformFee = (totalPrice * PLATFORM_FEE_BASIS_POINTS) / BASIS_POINTS;
        uint256 sellerAmount = totalPrice - platformFee;
        
        // Update listing
        listing.amount -= amount;
        if (listing.amount == 0) {
            listing.active = false;
        }
        
        // Transfer tokens to buyer
        IERC1155(address(carbonToken)).safeTransferFrom(
            address(this),
            msg.sender,
            listing.tokenId,
            amount,
            ""
        );
        
        // Transfer payment to seller
        payable(listing.seller).transfer(sellerAmount);
        
        // Update marketplace stats
        totalVolume += totalPrice;
        totalTransactions++;
        
        // Refund excess payment
        if (msg.value > totalPrice) {
            payable(msg.sender).transfer(msg.value - totalPrice);
        }
        
        emit ListingPurchased(listingId, listing.tokenId, msg.sender, amount, totalPrice);
    }
    
    function createAuction(
        uint256 tokenId,
        uint256 amount,
        uint256 startingPrice,
        uint256 duration
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");
        require(startingPrice > 0, "Starting price must be greater than 0");
        require(duration >= 1 hours && duration <= 7 days, "Invalid duration");
        
        ICarbonCreditToken.CarbonCredit memory credit = carbonToken.getCreditInfo(tokenId);
        require(credit.status == 2, "Credit not active");
        require(
            IERC1155(address(carbonToken)).balanceOf(msg.sender, tokenId) >= amount,
            "Insufficient token balance"
        );
        
        _auctionIdCounter++;
        uint256 auctionId = _auctionIdCounter;
        
        auctions[auctionId] = Auction({
            auctionId: auctionId,
            tokenId: tokenId,
            seller: msg.sender,
            amount: amount,
            startingPrice: startingPrice,
            currentBid: startingPrice,
            currentBidder: address(0),
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            active: true,
            finalized: false
        });
        
        // Transfer tokens to marketplace for escrow
        IERC1155(address(carbonToken)).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId,
            amount,
            ""
        );
        
        emit AuctionCreated(auctionId, tokenId, msg.sender, amount, startingPrice, block.timestamp + duration);
    }
    
    function placeBid(uint256 auctionId) external payable nonReentrant whenNotPaused {
        Auction storage auction = auctions[auctionId];
        require(auction.active, "Auction not active");
        require(block.timestamp < auction.endTime, "Auction ended");
        require(msg.sender != auction.seller, "Cannot bid on own auction");
        require(msg.value > auction.currentBid, "Bid too low");
        
        // Refund previous bidder
        if (auction.currentBidder != address(0)) {
            payable(auction.currentBidder).transfer(auction.currentBid);
        }
        
        auction.currentBid = msg.value;
        auction.currentBidder = msg.sender;
        userBids[msg.sender].push(auctionId);
        
        emit BidPlaced(auctionId, msg.sender, msg.value);
    }
    
    function finalizeAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        require(auction.active, "Auction not active");
        require(block.timestamp >= auction.endTime, "Auction still ongoing");
        require(!auction.finalized, "Auction already finalized");
        
        auction.active = false;
        auction.finalized = true;
        
        if (auction.currentBidder != address(0)) {
            // Calculate platform fee
            uint256 platformFee = (auction.currentBid * PLATFORM_FEE_BASIS_POINTS) / BASIS_POINTS;
            uint256 sellerAmount = auction.currentBid - platformFee;
            
            // Transfer tokens to winner
            IERC1155(address(carbonToken)).safeTransferFrom(
                address(this),
                auction.currentBidder,
                auction.tokenId,
                auction.amount,
                ""
            );
            
            // Transfer payment to seller
            payable(auction.seller).transfer(sellerAmount);
            
            totalVolume += auction.currentBid;
            totalTransactions++;
            
            emit AuctionFinalized(auctionId, auction.currentBidder, auction.currentBid);
        } else {
            // No bids, return tokens to seller
            IERC1155(address(carbonToken)).safeTransferFrom(
                address(this),
                auction.seller,
                auction.tokenId,
                auction.amount,
                ""
            );
        }
    }
    
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not listing owner");
        
        listing.active = false;
        
        // Return tokens to seller
        IERC1155(address(carbonToken)).safeTransferFrom(
            address(this),
            listing.seller,
            listing.tokenId,
            listing.amount,
            ""
        );
        
        emit ListingCancelled(listingId);
    }
    
    function getActiveListings() external view returns (uint256[] memory) {
        uint256[] memory activeListingIds = new uint256[](_listingIdCounter);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= _listingIdCounter; i++) {
            if (listings[i].active && listings[i].expiresAt > block.timestamp) {
                activeListingIds[count] = i;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = activeListingIds[i];
        }
        
        return result;
    }
    
    function getActiveAuctions() external view returns (uint256[] memory) {
        uint256[] memory activeAuctionIds = new uint256[](_auctionIdCounter);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= _auctionIdCounter; i++) {
            if (auctions[i].active && block.timestamp < auctions[i].endTime) {
                activeAuctionIds[count] = i;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = activeAuctionIds[i];
        }
        
        return result;
    }
    
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        payable(owner()).transfer(balance);
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
}
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarbonMarketplace", function () {
  let carbonToken, carbonMarketplace;
  let owner, seller, buyer, feeRecipient;
  let tokenId = 1;
  let listingPrice = ethers.parseEther("0.1");
  let amount = 100;

  beforeEach(async function () {
    [owner, seller, buyer, feeRecipient] = await ethers.getSigners();

    // Deploy CarbonCreditToken
    const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
    carbonToken = await CarbonCreditToken.deploy("https://gateway.pinata.cloud/ipfs/{id}");
    await carbonToken.waitForDeployment();

    // Deploy CarbonMarketplace
    const CarbonMarketplace = await ethers.getContractFactory("CarbonMarketplace");
    carbonMarketplace = await CarbonMarketplace.deploy(
      await carbonToken.getAddress(),
      250, // 2.5% platform fee
      await feeRecipient.getAddress()
    );
    await carbonMarketplace.waitForDeployment();

    // Setup roles and mint credits
    const MINTER_ROLE = await carbonToken.MINTER_ROLE();
    const VERIFIER_ROLE = await carbonToken.VERIFIER_ROLE();
    
    await carbonToken.grantRole(MINTER_ROLE, owner.address);
    await carbonToken.grantRole(VERIFIER_ROLE, owner.address);

    // Mint, verify, and activate credit
    const expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    await carbonToken.mintCarbonCredit(
      "PROJECT_001",
      "VERIFIED_CARBON_STANDARD",
      1000,
      expirationDate,
      "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D",
      1000
    );
    
    await carbonToken.verifyCredit(tokenId);
    await carbonToken.activateCredit(tokenId);

    // Transfer credits to seller
    await carbonToken.safeTransferFrom(
      owner.address,
      seller.address,
      tokenId,
      500,
      "0x"
    );

    // Approve marketplace to transfer seller's tokens
    await carbonToken.connect(seller).setApprovalForAll(carbonMarketplace.address, true);
  });

  describe("Deployment", function () {
    it("Should set correct initial parameters", async function () {
      expect(await carbonMarketplace.carbonToken()).to.equal(carbonToken.address);
      expect(await carbonMarketplace.platformFeePercent()).to.equal(250);
      expect(await carbonMarketplace.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should initialize with zero statistics", async function () {
      expect(await carbonMarketplace.totalVolume()).to.equal(0);
      expect(await carbonMarketplace.totalTransactions()).to.equal(0);
    });
  });

  describe("Listing Management", function () {
    it("Should create a fixed-price listing", async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      
      await expect(
        carbonMarketplace.connect(seller).createListing(
          tokenId,
          amount,
          listingPrice,
          expiryTime,
          0 // FIXED_PRICE
        )
      ).to.emit(carbonMarketplace, "ListingCreated");

      const listing = await carbonMarketplace.listings(1);
      expect(listing.tokenId).to.equal(tokenId);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.amount).to.equal(amount);
      expect(listing.pricePerCredit).to.equal(listingPrice);
      expect(listing.active).to.be.true;
    });

    it("Should not create listing with zero amount", async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await expect(
        carbonMarketplace.connect(seller).createListing(
          tokenId,
          0,
          listingPrice,
          expiryTime,
          0
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should not create listing with insufficient balance", async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await expect(
        carbonMarketplace.connect(seller).createListing(
          tokenId,
          1000, // Seller only has 500
          listingPrice,
          expiryTime,
          0
        )
      ).to.be.revertedWith("Insufficient token balance");
    });

    it("Should update listing price", async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await carbonMarketplace.connect(seller).createListing(
        tokenId,
        amount,
        listingPrice,
        expiryTime,
        0
      );

      const newPrice = ethers.utils.parseEther("0.2");
      await expect(
        carbonMarketplace.connect(seller).updateListing(1, amount, newPrice)
      ).to.emit(carbonMarketplace, "ListingUpdated");

      const listing = await carbonMarketplace.listings(1);
      expect(listing.pricePerCredit).to.equal(newPrice);
    });

    it("Should cancel listing", async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await carbonMarketplace.connect(seller).createListing(
        tokenId,
        amount,
        listingPrice,
        expiryTime,
        0
      );

      await expect(
        carbonMarketplace.connect(seller).cancelListing(1)
      ).to.emit(carbonMarketplace, "ListingCancelled");

      const listing = await carbonMarketplace.listings(1);
      expect(listing.active).to.be.false;
    });

    it("Should not allow non-seller to cancel listing", async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await carbonMarketplace.connect(seller).createListing(
        tokenId,
        amount,
        listingPrice,
        expiryTime,
        0
      );

      await expect(
        carbonMarketplace.connect(buyer).cancelListing(1)
      ).to.be.revertedWith("Only seller can cancel listing");
    });
  });

  describe("Purchase Process", function () {
    let listingId;

    beforeEach(async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await carbonMarketplace.connect(seller).createListing(
        tokenId,
        amount,
        listingPrice,
        expiryTime,
        0
      );
      listingId = 1;
    });

    it("Should complete purchase with correct payment", async function () {
      const totalCost = listingPrice.mul(amount);
      const platformFee = totalCost.mul(250).div(10000); // 2.5%
      const sellerAmount = totalCost.sub(platformFee);

      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const initialFeeRecipientBalance = await ethers.provider.getBalance(feeRecipient.address);

      await expect(
        carbonMarketplace.connect(buyer).purchaseCredits(listingId, amount, {
          value: totalCost
        })
      ).to.emit(carbonMarketplace, "CreditsPurchased");

      // Check token transfer
      expect(await carbonToken.balanceOf(buyer.address, tokenId)).to.equal(amount);
      expect(await carbonToken.balanceOf(seller.address, tokenId)).to.equal(400);

      // Check payment distribution
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalFeeRecipientBalance = await ethers.provider.getBalance(feeRecipient.address);

      expect(finalSellerBalance.sub(initialSellerBalance)).to.equal(sellerAmount);
      expect(finalFeeRecipientBalance.sub(initialFeeRecipientBalance)).to.equal(platformFee);

      // Check listing status
      const listing = await carbonMarketplace.listings(listingId);
      expect(listing.active).to.be.false;
    });

    it("Should handle partial purchase", async function () {
      const purchaseAmount = 50;
      const totalCost = listingPrice.mul(purchaseAmount);

      await carbonMarketplace.connect(buyer).purchaseCredits(listingId, purchaseAmount, {
        value: totalCost
      });

      expect(await carbonToken.balanceOf(buyer.address, tokenId)).to.equal(purchaseAmount);

      const listing = await carbonMarketplace.listings(listingId);
      expect(listing.amount).to.equal(amount - purchaseAmount);
      expect(listing.active).to.be.true;
    });

    it("Should reject purchase with insufficient payment", async function () {
      const insufficientPayment = listingPrice.mul(amount).div(2);

      await expect(
        carbonMarketplace.connect(buyer).purchaseCredits(listingId, amount, {
          value: insufficientPayment
        })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should reject purchase of more than available", async function () {
      const totalCost = listingPrice.mul(amount + 50);

      await expect(
        carbonMarketplace.connect(buyer).purchaseCredits(listingId, amount + 50, {
          value: totalCost
        })
      ).to.be.revertedWith("Insufficient credits in listing");
    });

    it("Should refund excess payment", async function () {
      const excessPayment = listingPrice.mul(amount).mul(2);
      const expectedRefund = excessPayment.sub(listingPrice.mul(amount));

      const initialBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await carbonMarketplace.connect(buyer).purchaseCredits(listingId, amount, {
        value: excessPayment
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const finalBalance = await ethers.provider.getBalance(buyer.address);
      const actualRefund = initialBalance.sub(finalBalance).sub(gasUsed).sub(listingPrice.mul(amount));

      expect(actualRefund).to.be.closeTo(ethers.constants.Zero, ethers.utils.parseEther("0.001"));
    });
  });

  describe("Auction System", function () {
    let auctionId;
    let reservePrice = ethers.utils.parseEther("0.05");

    beforeEach(async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await carbonMarketplace.connect(seller).createListing(
        tokenId,
        amount,
        reservePrice,
        expiryTime,
        1 // AUCTION
      );
      auctionId = 1;
    });

    it("Should place valid bid on auction", async function () {
      const bidAmount = ethers.utils.parseEther("0.08");

      await expect(
        carbonMarketplace.connect(buyer).placeBid(auctionId, {
          value: bidAmount
        })
      ).to.emit(carbonMarketplace, "BidPlaced");

      const auction = await carbonMarketplace.auctions(auctionId);
      expect(auction.highestBidder).to.equal(buyer.address);
      expect(auction.highestBid).to.equal(bidAmount);
    });

    it("Should reject bid below reserve price", async function () {
      const lowBid = ethers.utils.parseEther("0.03");

      await expect(
        carbonMarketplace.connect(buyer).placeBid(auctionId, {
          value: lowBid
        })
      ).to.be.revertedWith("Bid below reserve price");
    });

    it("Should reject bid lower than current highest", async function () {
      const firstBid = ethers.utils.parseEther("0.08");
      const lowerBid = ethers.utils.parseEther("0.06");

      await carbonMarketplace.connect(buyer).placeBid(auctionId, {
        value: firstBid
      });

      await expect(
        carbonMarketplace.connect(seller).placeBid(auctionId, {
          value: lowerBid
        })
      ).to.be.revertedWith("Bid must be higher than current highest bid");
    });

    it("Should refund previous bidder when outbid", async function () {
      const firstBid = ethers.utils.parseEther("0.08");
      const secondBid = ethers.utils.parseEther("0.12");

      // Place first bid
      await carbonMarketplace.connect(buyer).placeBid(auctionId, {
        value: firstBid
      });

      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);

      // Place higher bid from another account
      await carbonMarketplace.connect(feeRecipient).placeBid(auctionId, {
        value: secondBid
      });

      const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerBalanceAfter.sub(buyerBalanceBefore)).to.equal(firstBid);
    });
  });

  describe("Batch Operations", function () {
    let listingIds = [];

    beforeEach(async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      // Create multiple listings
      for (let i = 0; i < 3; i++) {
        await carbonMarketplace.connect(seller).createListing(
          tokenId,
          50,
          listingPrice,
          expiryTime,
          0
        );
        listingIds.push(i + 1);
      }
    });

    it("Should execute batch purchase", async function () {
      const amounts = [25, 30, 20];
      const totalCost = listingPrice.mul(amounts.reduce((a, b) => a + b, 0));

      await expect(
        carbonMarketplace.connect(buyer).batchPurchase(listingIds, amounts, {
          value: totalCost
        })
      ).to.emit(carbonMarketplace, "BatchPurchaseCompleted");

      expect(await carbonToken.balanceOf(buyer.address, tokenId)).to.equal(75);
    });

    it("Should cancel multiple listings", async function () {
      await expect(
        carbonMarketplace.connect(seller).batchCancel(listingIds)
      ).to.emit(carbonMarketplace, "BatchCancelCompleted");

      for (let id of listingIds) {
        const listing = await carbonMarketplace.listings(id);
        expect(listing.active).to.be.false;
      }
    });
  });

  describe("Fee Management", function () {
    it("Should update platform fee", async function () {
      const newFeePercent = 500; // 5%
      
      await carbonMarketplace.updatePlatformFee(newFeePercent);
      expect(await carbonMarketplace.platformFeePercent()).to.equal(newFeePercent);
    });

    it("Should not allow fee above maximum", async function () {
      const excessiveFee = 1001; // 10.01%
      
      await expect(
        carbonMarketplace.updatePlatformFee(excessiveFee)
      ).to.be.revertedWith("Fee cannot exceed 10%");
    });

    it("Should update fee recipient", async function () {
      await carbonMarketplace.updateFeeRecipient(buyer.address);
      expect(await carbonMarketplace.feeRecipient()).to.equal(buyer.address);
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await carbonMarketplace.connect(seller).createListing(
        tokenId,
        amount,
        listingPrice,
        expiryTime,
        0
      );
    });

    it("Should return active listings", async function () {
      const activeListings = await carbonMarketplace.getActiveListings();
      expect(activeListings.length).to.equal(1);
      expect(activeListings[0]).to.equal(1);
    });

    it("Should return seller listings", async function () {
      const sellerListings = await carbonMarketplace.getSellerListings(seller.address);
      expect(sellerListings.length).to.equal(1);
      expect(sellerListings[0]).to.equal(1);
    });

    it("Should update statistics after purchase", async function () {
      const totalCost = listingPrice.mul(amount);
      
      await carbonMarketplace.connect(buyer).purchaseCredits(1, amount, {
        value: totalCost
      });

      expect(await carbonMarketplace.totalVolume()).to.equal(totalCost);
      expect(await carbonMarketplace.totalTransactions()).to.equal(1);
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause and unpause contract", async function () {
      await carbonMarketplace.pause();
      expect(await carbonMarketplace.paused()).to.be.true;
      
      await carbonMarketplace.unpause();
      expect(await carbonMarketplace.paused()).to.be.false;
    });

    it("Should not allow operations when paused", async function () {
      await carbonMarketplace.pause();
      const expiryTime = Math.floor(Date.now() / 1000) + 3600;
      
      await expect(
        carbonMarketplace.connect(seller).createListing(
          tokenId,
          amount,
          listingPrice,
          expiryTime,
          0
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });
});
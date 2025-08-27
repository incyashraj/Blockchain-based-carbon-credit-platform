const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarbonCreditToken", function () {
  let carbonToken;
  let owner, minter, verifier, user1, user2;
  let projectId = "PROJECT_001";
  let methodology = "VERIFIED_CARBON_STANDARD";
  let co2Equivalent = 1000;
  let expirationDate;
  let ipfsHash = "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D";

  beforeEach(async function () {
    [owner, minter, verifier, user1, user2] = await ethers.getSigners();
    
    const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
    carbonToken = await CarbonCreditToken.deploy("https://gateway.pinata.cloud/ipfs/{id}");
    await carbonToken.waitForDeployment();

    // Set expiration date to 1 year from now
    expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    // Grant roles
    const MINTER_ROLE = await carbonToken.MINTER_ROLE();
    const VERIFIER_ROLE = await carbonToken.VERIFIER_ROLE();
    
    await carbonToken.grantRole(MINTER_ROLE, minter.address);
    await carbonToken.grantRole(VERIFIER_ROLE, verifier.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const DEFAULT_ADMIN_ROLE = await carbonToken.DEFAULT_ADMIN_ROLE();
      expect(await carbonToken.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should initialize with correct name and symbol", async function () {
      expect(await carbonToken.name()).to.equal("Carbon Credit Token");
      expect(await carbonToken.symbol()).to.equal("CCT");
    });

    it("Should start unpaused", async function () {
      expect(await carbonToken.paused()).to.be.false;
    });
  });

  describe("Role Management", function () {
    it("Should grant and revoke MINTER_ROLE", async function () {
      const MINTER_ROLE = await carbonToken.MINTER_ROLE();
      
      await carbonToken.grantRole(MINTER_ROLE, user1.address);
      expect(await carbonToken.hasRole(MINTER_ROLE, user1.address)).to.be.true;
      
      await carbonToken.revokeRole(MINTER_ROLE, user1.address);
      expect(await carbonToken.hasRole(MINTER_ROLE, user1.address)).to.be.false;
    });

    it("Should not allow non-admin to grant roles", async function () {
      const MINTER_ROLE = await carbonToken.MINTER_ROLE();
      
      await expect(
        carbonToken.connect(user1).grantRole(MINTER_ROLE, user2.address)
      ).to.be.reverted;
    });
  });

  describe("Minting Carbon Credits", function () {
    it("Should mint carbon credits with correct parameters", async function () {
      await expect(
        carbonToken.connect(minter).mintCarbonCredit(
          projectId,
          methodology,
          co2Equivalent,
          expirationDate,
          ipfsHash,
          100
        )
      ).to.emit(carbonToken, "CreditMinted")
       .withArgs(1, projectId, co2Equivalent, minter.address);

      const creditInfo = await carbonToken.getCreditInfo(1);
      expect(creditInfo.projectId).to.equal(projectId);
      expect(creditInfo.methodology).to.equal(methodology);
      expect(creditInfo.co2Equivalent).to.equal(co2Equivalent);
      expect(creditInfo.totalSupply).to.equal(100);
      expect(creditInfo.availableSupply).to.equal(100);
      expect(creditInfo.status).to.equal(0); // PENDING
    });

    it("Should not allow non-minter to mint credits", async function () {
      await expect(
        carbonToken.connect(user1).mintCarbonCredit(
          projectId,
          methodology,
          co2Equivalent,
          expirationDate,
          ipfsHash,
          100
        )
      ).to.be.reverted;
    });

    it("Should not mint with zero amount", async function () {
      await expect(
        carbonToken.connect(minter).mintCarbonCredit(
          projectId,
          methodology,
          co2Equivalent,
          expirationDate,
          ipfsHash,
          0
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should not mint with past expiration date", async function () {
      const pastDate = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      
      await expect(
        carbonToken.connect(minter).mintCarbonCredit(
          projectId,
          methodology,
          co2Equivalent,
          pastDate,
          ipfsHash,
          100
        )
      ).to.be.revertedWith("Expiration date must be in the future");
    });
  });

  describe("Verification Process", function () {
    let tokenId;

    beforeEach(async function () {
      await carbonToken.connect(minter).mintCarbonCredit(
        projectId,
        methodology,
        co2Equivalent,
        expirationDate,
        ipfsHash,
        100
      );
      tokenId = 1;
    });

    it("Should verify credit and change status", async function () {
      await expect(
        carbonToken.connect(verifier).verifyCredit(tokenId)
      ).to.emit(carbonToken, "CreditVerified")
       .withArgs(tokenId, verifier.address);

      const creditInfo = await carbonToken.getCreditInfo(tokenId);
      expect(creditInfo.verified).to.be.true;
      expect(creditInfo.status).to.equal(1); // VERIFIED
    });

    it("Should not allow non-verifier to verify", async function () {
      await expect(
        carbonToken.connect(user1).verifyCredit(tokenId)
      ).to.be.reverted;
    });

    it("Should activate verified credit", async function () {
      await carbonToken.connect(verifier).verifyCredit(tokenId);
      
      await expect(
        carbonToken.connect(verifier).activateCredit(tokenId)
      ).to.emit(carbonToken, "CreditActivated")
       .withArgs(tokenId, verifier.address);

      const creditInfo = await carbonToken.getCreditInfo(tokenId);
      expect(creditInfo.status).to.equal(2); // ACTIVE
    });

    it("Should not activate unverified credit", async function () {
      await expect(
        carbonToken.connect(verifier).activateCredit(tokenId)
      ).to.be.revertedWith("Credit must be verified first");
    });
  });

  describe("Transfer and Trading", function () {
    let tokenId;

    beforeEach(async function () {
      await carbonToken.connect(minter).mintCarbonCredit(
        projectId,
        methodology,
        co2Equivalent,
        expirationDate,
        ipfsHash,
        100
      );
      tokenId = 1;
      
      // Verify and activate the credit
      await carbonToken.connect(verifier).verifyCredit(tokenId);
      await carbonToken.connect(verifier).activateCredit(tokenId);
      
      // Transfer some credits to user1
      await carbonToken.connect(minter).safeTransferFrom(
        minter.address,
        user1.address,
        tokenId,
        50,
        "0x"
      );
    });

    it("Should transfer credits between accounts", async function () {
      await carbonToken.connect(user1).safeTransferFrom(
        user1.address,
        user2.address,
        tokenId,
        25,
        "0x"
      );

      expect(await carbonToken.balanceOf(user1.address, tokenId)).to.equal(25);
      expect(await carbonToken.balanceOf(user2.address, tokenId)).to.equal(25);
    });

    it("Should not transfer more credits than owned", async function () {
      await expect(
        carbonToken.connect(user1).safeTransferFrom(
          user1.address,
          user2.address,
          tokenId,
          100,
          "0x"
        )
      ).to.be.revertedWith("ERC1155: insufficient balance for transfer");
    });

    it("Should approve and transfer on behalf", async function () {
      await carbonToken.connect(user1).setApprovalForAll(user2.address, true);
      
      await carbonToken.connect(user2).safeTransferFrom(
        user1.address,
        user2.address,
        tokenId,
        25,
        "0x"
      );

      expect(await carbonToken.balanceOf(user1.address, tokenId)).to.equal(25);
      expect(await carbonToken.balanceOf(user2.address, tokenId)).to.equal(25);
    });
  });

  describe("Retirement Process", function () {
    let tokenId;

    beforeEach(async function () {
      await carbonToken.connect(minter).mintCarbonCredit(
        projectId,
        methodology,
        co2Equivalent,
        expirationDate,
        ipfsHash,
        100
      );
      tokenId = 1;
      
      await carbonToken.connect(verifier).verifyCredit(tokenId);
      await carbonToken.connect(verifier).activateCredit(tokenId);
      
      await carbonToken.connect(minter).safeTransferFrom(
        minter.address,
        user1.address,
        tokenId,
        50,
        "0x"
      );
    });

    it("Should retire credits and emit event", async function () {
      await expect(
        carbonToken.connect(user1).retireCredit(tokenId, 25)
      ).to.emit(carbonToken, "CreditRetired")
       .withArgs(tokenId, 25, user1.address);

      expect(await carbonToken.balanceOf(user1.address, tokenId)).to.equal(25);
      
      const creditInfo = await carbonToken.getCreditInfo(tokenId);
      expect(creditInfo.availableSupply).to.equal(75);
    });

    it("Should not retire more than owned", async function () {
      await expect(
        carbonToken.connect(user1).retireCredit(tokenId, 100)
      ).to.be.revertedWith("Insufficient balance to retire");
    });

    it("Should track total retired credits", async function () {
      await carbonToken.connect(user1).retireCredit(tokenId, 25);
      
      expect(await carbonToken.getTotalRetiredCredits(user1.address)).to.equal(25);
    });
  });

  describe("Pause Functionality", function () {
    it("Should pause and unpause contract", async function () {
      await carbonToken.pause();
      expect(await carbonToken.paused()).to.be.true;
      
      await carbonToken.unpause();
      expect(await carbonToken.paused()).to.be.false;
    });

    it("Should not allow minting when paused", async function () {
      await carbonToken.pause();
      
      await expect(
        carbonToken.connect(minter).mintCarbonCredit(
          projectId,
          methodology,
          co2Equivalent,
          expirationDate,
          ipfsHash,
          100
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Query Functions", function () {
    let tokenId1, tokenId2;

    beforeEach(async function () {
      await carbonToken.connect(minter).mintCarbonCredit(
        "PROJECT_001",
        methodology,
        co2Equivalent,
        expirationDate,
        ipfsHash,
        100
      );
      tokenId1 = 1;

      await carbonToken.connect(minter).mintCarbonCredit(
        "PROJECT_002",
        methodology,
        co2Equivalent * 2,
        expirationDate,
        ipfsHash,
        200
      );
      tokenId2 = 2;

      // Verify and activate both credits
      await carbonToken.connect(verifier).verifyCredit(tokenId1);
      await carbonToken.connect(verifier).activateCredit(tokenId1);
      await carbonToken.connect(verifier).verifyCredit(tokenId2);
      await carbonToken.connect(verifier).activateCredit(tokenId2);
    });

    it("Should return active credits", async function () {
      const activeCredits = await carbonToken.getActiveCredits();
      expect(activeCredits.length).to.equal(2);
      expect(activeCredits[0]).to.equal(tokenId1);
      expect(activeCredits[1]).to.equal(tokenId2);
    });

    it("Should return user credits after transfer", async function () {
      await carbonToken.connect(minter).safeTransferFrom(
        minter.address,
        user1.address,
        tokenId1,
        50,
        "0x"
      );

      const userCredits = await carbonToken.getUserCredits(user1.address);
      expect(userCredits.length).to.equal(1);
      expect(userCredits[0]).to.equal(tokenId1);
    });

    it("Should return correct URI", async function () {
      const uri = await carbonToken.uri(tokenId1);
      expect(uri).to.include(ipfsHash);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle expired credits", async function () {
      const expiredDate = Math.floor(Date.now() / 1000) + 1; // 1 second from now
      
      await carbonToken.connect(minter).mintCarbonCredit(
        projectId,
        methodology,
        co2Equivalent,
        expiredDate,
        ipfsHash,
        100
      );
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const creditInfo = await carbonToken.getCreditInfo(1);
      expect(creditInfo.expirationDate).to.be.lessThan(Math.floor(Date.now() / 1000));
    });

    it("Should handle zero balance queries", async function () {
      expect(await carbonToken.balanceOf(user1.address, 999)).to.equal(0);
    });

    it("Should handle non-existent token queries", async function () {
      const creditInfo = await carbonToken.getCreditInfo(999);
      expect(creditInfo.tokenId).to.equal(0);
    });
  });
});
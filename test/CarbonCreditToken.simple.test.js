const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarbonCreditToken - Simple Tests", function () {
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
    
    await carbonToken.grantRole(MINTER_ROLE, await minter.getAddress());
    await carbonToken.grantRole(VERIFIER_ROLE, await verifier.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const DEFAULT_ADMIN_ROLE = await carbonToken.DEFAULT_ADMIN_ROLE();
      expect(await carbonToken.hasRole(DEFAULT_ADMIN_ROLE, await owner.getAddress())).to.be.true;
    });

    it("Should start unpaused", async function () {
      expect(await carbonToken.paused()).to.be.false;
    });
  });

  describe("Minting Carbon Credits", function () {
    it("Should mint carbon credits with correct parameters", async function () {
      const tx = await carbonToken.connect(minter).mintCarbonCredit(
        projectId,
        methodology,
        co2Equivalent,
        expirationDate,
        ipfsHash,
        100
      );

      await expect(tx)
        .to.emit(carbonToken, "CreditMinted")
        .withArgs(1, projectId, co2Equivalent, await minter.getAddress());

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
       .withArgs(tokenId, await verifier.getAddress());

      const creditInfo = await carbonToken.getCreditInfo(tokenId);
      expect(creditInfo.verified).to.be.true;
      expect(creditInfo.status).to.equal(1); // VERIFIED
    });

    it("Should activate verified credit", async function () {
      await carbonToken.connect(verifier).verifyCredit(tokenId);
      
      await expect(
        carbonToken.connect(verifier).activateCredit(tokenId)
      ).to.emit(carbonToken, "CreditActivated")
       .withArgs(tokenId, await verifier.getAddress());

      const creditInfo = await carbonToken.getCreditInfo(tokenId);
      expect(creditInfo.status).to.equal(2); // ACTIVE
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
        await minter.getAddress(),
        await user1.getAddress(),
        tokenId,
        50,
        "0x"
      );
    });

    it("Should transfer credits between accounts", async function () {
      await carbonToken.connect(user1).safeTransferFrom(
        await user1.getAddress(),
        await user2.getAddress(),
        tokenId,
        25,
        "0x"
      );

      expect(await carbonToken.balanceOf(await user1.getAddress(), tokenId)).to.equal(25);
      expect(await carbonToken.balanceOf(await user2.getAddress(), tokenId)).to.equal(25);
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
        await minter.getAddress(),
        await user1.getAddress(),
        tokenId,
        50,
        "0x"
      );
    });

    it("Should retire credits and emit event", async function () {
      await expect(
        carbonToken.connect(user1).retireCredit(tokenId, 25)
      ).to.emit(carbonToken, "CreditRetired")
       .withArgs(tokenId, 25, await user1.getAddress());

      expect(await carbonToken.balanceOf(await user1.getAddress(), tokenId)).to.equal(25);
      
      const creditInfo = await carbonToken.getCreditInfo(tokenId);
      expect(creditInfo.availableSupply).to.equal(75);
    });

    it("Should track total retired credits", async function () {
      await carbonToken.connect(user1).retireCredit(tokenId, 25);
      
      expect(await carbonToken.getTotalRetiredCredits(await user1.getAddress())).to.equal(25);
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
        await minter.getAddress(),
        await user1.getAddress(),
        tokenId1,
        50,
        "0x"
      );

      const userCredits = await carbonToken.getUserCredits(await user1.getAddress());
      expect(userCredits.length).to.equal(1);
      expect(userCredits[0]).to.equal(tokenId1);
    });
  });
});
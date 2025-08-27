const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarbonOracle", function () {
  let carbonOracle, carbonToken;
  let owner, dataProvider, verifier, user1;
  let sensorId = "SENSOR_001";
  let projectId = "PROJECT_001";

  beforeEach(async function () {
    [owner, dataProvider, verifier, user1] = await ethers.getSigners();

    // Deploy CarbonCreditToken first
    const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
    carbonToken = await CarbonCreditToken.deploy("https://gateway.pinata.cloud/ipfs/{id}");
    await carbonToken.deployed();

    // Deploy CarbonOracle
    const CarbonOracle = await ethers.getContractFactory("CarbonOracle");
    carbonOracle = await CarbonOracle.deploy(carbonToken.address);
    await carbonOracle.deployed();

    // Grant roles
    const DATA_PROVIDER_ROLE = await carbonOracle.DATA_PROVIDER_ROLE();
    const VERIFIER_ROLE = await carbonOracle.VERIFIER_ROLE();
    
    await carbonOracle.grantRole(DATA_PROVIDER_ROLE, dataProvider.address);
    await carbonOracle.grantRole(VERIFIER_ROLE, verifier.address);

    // Set oracle in carbon token
    const ORACLE_ROLE = await carbonToken.ORACLE_ROLE();
    await carbonToken.grantRole(ORACLE_ROLE, carbonOracle.address);
  });

  describe("Deployment", function () {
    it("Should set correct carbon token address", async function () {
      expect(await carbonOracle.carbonToken()).to.equal(carbonToken.address);
    });

    it("Should set correct AI verification threshold", async function () {
      expect(await carbonOracle.aiVerificationThreshold()).to.equal(90);
    });

    it("Should initialize counters to zero", async function () {
      expect(await carbonOracle.emissionDataCounter()).to.equal(0);
      expect(await carbonOracle.verificationRequestCounter()).to.equal(0);
    });
  });

  describe("Emission Data Submission", function () {
    it("Should submit emission data successfully", async function () {
      const co2Reading = 450;
      const location = 12345678;
      const dataHash = "0x" + "a".repeat(64);

      await expect(
        carbonOracle.connect(dataProvider).submitEmissionData(
          sensorId,
          co2Reading,
          location,
          dataHash
        )
      ).to.emit(carbonOracle, "EmissionDataSubmitted")
       .withArgs(1, sensorId, co2Reading, dataProvider.address);

      const emissionData = await carbonOracle.emissionData(1);
      expect(emissionData.sensorId).to.equal(sensorId);
      expect(emissionData.co2Reading).to.equal(co2Reading);
      expect(emissionData.location).to.equal(location);
      expect(emissionData.dataProvider).to.equal(dataProvider.address);
      expect(emissionData.verified).to.be.false;
    });

    it("Should not allow non-provider to submit data", async function () {
      await expect(
        carbonOracle.connect(user1).submitEmissionData(
          sensorId,
          450,
          12345678,
          "0x" + "a".repeat(64)
        )
      ).to.be.reverted;
    });

    it("Should not submit data with zero CO2 reading", async function () {
      await expect(
        carbonOracle.connect(dataProvider).submitEmissionData(
          sensorId,
          0,
          12345678,
          "0x" + "a".repeat(64)
        )
      ).to.be.revertedWith("CO2 reading must be greater than 0");
    });

    it("Should increment emission data counter", async function () {
      await carbonOracle.connect(dataProvider).submitEmissionData(
        sensorId,
        450,
        12345678,
        "0x" + "a".repeat(64)
      );

      expect(await carbonOracle.emissionDataCounter()).to.equal(1);
    });
  });

  describe("AI Verification Process", function () {
    let emissionDataId;

    beforeEach(async function () {
      await carbonOracle.connect(dataProvider).submitEmissionData(
        sensorId,
        450,
        12345678,
        "0x" + "a".repeat(64)
      );
      emissionDataId = 1;
    });

    it("Should auto-approve with high AI confidence", async function () {
      const highConfidence = 95;

      await expect(
        carbonOracle.connect(verifier).submitAIVerification(
          emissionDataId,
          true,
          highConfidence,
          "High confidence verification"
        )
      ).to.emit(carbonOracle, "AIVerificationCompleted")
       .withArgs(emissionDataId, true, highConfidence);

      const emissionData = await carbonOracle.emissionData(emissionDataId);
      expect(emissionData.verified).to.be.true;
      expect(emissionData.aiConfidence).to.equal(highConfidence);
    });

    it("Should require human verification with low confidence", async function () {
      const lowConfidence = 85;

      await carbonOracle.connect(verifier).submitAIVerification(
        emissionDataId,
        true,
        lowConfidence,
        "Low confidence verification"
      );

      const emissionData = await carbonOracle.emissionData(emissionDataId);
      expect(emissionData.verified).to.be.false;
      expect(emissionData.aiConfidence).to.equal(lowConfidence);
    });

    it("Should flag fraudulent data", async function () {
      const fraudConfidence = 95;

      await expect(
        carbonOracle.connect(verifier).submitAIVerification(
          emissionDataId,
          false,
          fraudConfidence,
          "Fraud detected"
        )
      ).to.emit(carbonOracle, "FraudDetected")
       .withArgs(emissionDataId, dataProvider.address, fraudConfidence);

      const emissionData = await carbonOracle.emissionData(emissionDataId);
      expect(emissionData.flagged).to.be.true;
    });

    it("Should update AI threshold", async function () {
      const newThreshold = 85;
      
      await carbonOracle.updateAIVerificationThreshold(newThreshold);
      expect(await carbonOracle.aiVerificationThreshold()).to.equal(newThreshold);
    });

    it("Should not allow threshold above 100", async function () {
      await expect(
        carbonOracle.updateAIVerificationThreshold(101)
      ).to.be.revertedWith("Threshold must be between 1 and 100");
    });
  });

  describe("Human Verification", function () {
    let emissionDataId;

    beforeEach(async function () {
      await carbonOracle.connect(dataProvider).submitEmissionData(
        sensorId,
        450,
        12345678,
        "0x" + "a".repeat(64)
      );
      emissionDataId = 1;

      // Submit low confidence AI verification
      await carbonOracle.connect(verifier).submitAIVerification(
        emissionDataId,
        true,
        85,
        "Low confidence"
      );
    });

    it("Should allow human verifier to approve data", async function () {
      await expect(
        carbonOracle.connect(verifier).humanVerifyEmissionData(
          emissionDataId,
          true,
          "Manually verified as accurate"
        )
      ).to.emit(carbonOracle, "HumanVerificationCompleted");

      const emissionData = await carbonOracle.emissionData(emissionDataId);
      expect(emissionData.verified).to.be.true;
      expect(emissionData.humanVerified).to.be.true;
    });

    it("Should allow human verifier to reject data", async function () {
      await carbonOracle.connect(verifier).humanVerifyEmissionData(
        emissionDataId,
        false,
        "Data appears inaccurate"
      );

      const emissionData = await carbonOracle.emissionData(emissionDataId);
      expect(emissionData.verified).to.be.false;
      expect(emissionData.humanVerified).to.be.true;
    });

    it("Should not allow non-verifier to human verify", async function () {
      await expect(
        carbonOracle.connect(user1).humanVerifyEmissionData(
          emissionDataId,
          true,
          "Unauthorized verification"
        )
      ).to.be.reverted;
    });
  });

  describe("Verification Request System", function () {
    let emissionDataIds = [];

    beforeEach(async function () {
      // Submit multiple emission data entries
      for (let i = 0; i < 3; i++) {
        await carbonOracle.connect(dataProvider).submitEmissionData(
          `SENSOR_00${i + 1}`,
          400 + i * 50,
          12345678 + i,
          "0x" + "a".repeat(64)
        );
        emissionDataIds.push(i + 1);
        
        // Verify each data entry
        await carbonOracle.connect(verifier).submitAIVerification(
          i + 1,
          true,
          95,
          "High confidence"
        );
      }
    });

    it("Should create verification request", async function () {
      const methodology = "VERIFIED_CARBON_STANDARD";
      const co2Equivalent = 1500;
      const ipfsHash = "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D";

      await expect(
        carbonOracle.connect(dataProvider).requestVerification(
          projectId,
          emissionDataIds,
          methodology,
          co2Equivalent,
          ipfsHash
        )
      ).to.emit(carbonOracle, "VerificationRequestCreated")
       .withArgs(1, projectId, dataProvider.address);

      const request = await carbonOracle.verificationRequests(1);
      expect(request.projectId).to.equal(projectId);
      expect(request.methodology).to.equal(methodology);
      expect(request.co2Equivalent).to.equal(co2Equivalent);
      expect(request.requester).to.equal(dataProvider.address);
      expect(request.status).to.equal(0); // PENDING
    });

    it("Should not create request with unverified data", async function () {
      // Submit new unverified data
      await carbonOracle.connect(dataProvider).submitEmissionData(
        "SENSOR_004",
        500,
        12345678,
        "0x" + "a".repeat(64)
      );

      await expect(
        carbonOracle.connect(dataProvider).requestVerification(
          projectId,
          [4],
          "VERIFIED_CARBON_STANDARD",
          500,
          "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D"
        )
      ).to.be.revertedWith("All emission data must be verified");
    });

    it("Should approve verification request and mint credits", async function () {
      // Create request
      await carbonOracle.connect(dataProvider).requestVerification(
        projectId,
        emissionDataIds,
        "VERIFIED_CARBON_STANDARD",
        1500,
        "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D"
      );

      // Grant minter role to oracle for carbon token
      const MINTER_ROLE = await carbonToken.MINTER_ROLE();
      await carbonToken.grantRole(MINTER_ROLE, carbonOracle.address);

      const expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      
      await expect(
        carbonOracle.connect(verifier).approveVerificationRequest(
          1,
          expirationDate,
          1000
        )
      ).to.emit(carbonOracle, "VerificationRequestApproved");

      const request = await carbonOracle.verificationRequests(1);
      expect(request.status).to.equal(1); // APPROVED
    });

    it("Should reject verification request", async function () {
      await carbonOracle.connect(dataProvider).requestVerification(
        projectId,
        emissionDataIds,
        "VERIFIED_CARBON_STANDARD",
        1500,
        "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D"
      );

      await expect(
        carbonOracle.connect(verifier).rejectVerificationRequest(
          1,
          "Insufficient data quality"
        )
      ).to.emit(carbonOracle, "VerificationRequestRejected");

      const request = await carbonOracle.verificationRequests(1);
      expect(request.status).to.equal(2); // REJECTED
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      // Submit and verify emission data
      await carbonOracle.connect(dataProvider).submitEmissionData(
        sensorId,
        450,
        12345678,
        "0x" + "a".repeat(64)
      );

      await carbonOracle.connect(verifier).submitAIVerification(
        1,
        true,
        95,
        "High confidence"
      );

      // Create verification request
      await carbonOracle.connect(dataProvider).requestVerification(
        projectId,
        [1],
        "VERIFIED_CARBON_STANDARD",
        450,
        "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D"
      );
    });

    it("Should return sensor data by sensor ID", async function () {
      const sensorData = await carbonOracle.getSensorData(sensorId);
      expect(sensorData.length).to.equal(1);
      expect(sensorData[0]).to.equal(1);
    });

    it("Should return pending verification requests", async function () {
      const pendingRequests = await carbonOracle.getPendingRequests();
      expect(pendingRequests.length).to.equal(1);
      expect(pendingRequests[0]).to.equal(1);
    });

    it("Should return provider data", async function () {
      const providerData = await carbonOracle.getProviderData(dataProvider.address);
      expect(providerData.length).to.equal(1);
      expect(providerData[0]).to.equal(1);
    });

    it("Should return verification statistics", async function () {
      const stats = await carbonOracle.getVerificationStats();
      expect(stats.totalEmissionData).to.equal(1);
      expect(stats.totalVerificationRequests).to.equal(1);
      expect(stats.pendingRequests).to.equal(1);
    });
  });

  describe("Data Provider Management", function () {
    it("Should register data provider with metadata", async function () {
      const metadata = "Certified IoT sensor provider";
      
      await expect(
        carbonOracle.registerDataProvider(user1.address, metadata)
      ).to.emit(carbonOracle, "DataProviderRegistered");

      const providerInfo = await carbonOracle.dataProviders(user1.address);
      expect(providerInfo.isActive).to.be.true;
      expect(providerInfo.metadata).to.equal(metadata);
    });

    it("Should deactivate data provider", async function () {
      await carbonOracle.registerDataProvider(user1.address, "Test provider");
      
      await carbonOracle.deactivateDataProvider(user1.address);
      
      const providerInfo = await carbonOracle.dataProviders(user1.address);
      expect(providerInfo.isActive).to.be.false;
    });

    it("Should update provider reputation", async function () {
      await carbonOracle.registerDataProvider(dataProvider.address, "Test provider");
      
      // Approve a verification request to increase reputation
      await carbonOracle.connect(dataProvider).submitEmissionData(
        sensorId,
        450,
        12345678,
        "0x" + "a".repeat(64)
      );
      
      await carbonOracle.connect(verifier).submitAIVerification(1, true, 95, "Verified");
      
      const providerInfo = await carbonOracle.dataProviders(dataProvider.address);
      expect(providerInfo.submissionCount).to.equal(1);
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause and unpause contract", async function () {
      await carbonOracle.pause();
      expect(await carbonOracle.paused()).to.be.true;
      
      await carbonOracle.unpause();
      expect(await carbonOracle.paused()).to.be.false;
    });

    it("Should not allow data submission when paused", async function () {
      await carbonOracle.pause();
      
      await expect(
        carbonOracle.connect(dataProvider).submitEmissionData(
          sensorId,
          450,
          12345678,
          "0x" + "a".repeat(64)
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle large CO2 readings", async function () {
      const largeCO2Reading = 999999999;
      
      await carbonOracle.connect(dataProvider).submitEmissionData(
        sensorId,
        largeCO2Reading,
        12345678,
        "0x" + "a".repeat(64)
      );

      const emissionData = await carbonOracle.emissionData(1);
      expect(emissionData.co2Reading).to.equal(largeCO2Reading);
    });

    it("Should handle empty emission data array in verification request", async function () {
      await expect(
        carbonOracle.connect(dataProvider).requestVerification(
          projectId,
          [],
          "VERIFIED_CARBON_STANDARD",
          0,
          "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D"
        )
      ).to.be.revertedWith("Must provide emission data IDs");
    });

    it("Should handle non-existent emission data queries", async function () {
      const emissionData = await carbonOracle.emissionData(999);
      expect(emissionData.id).to.equal(0);
    });

    it("Should handle non-existent verification request queries", async function () {
      const request = await carbonOracle.verificationRequests(999);
      expect(request.id).to.equal(0);
    });
  });
});
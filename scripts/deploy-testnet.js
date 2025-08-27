const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("🚀 Starting Carbon Credit System Testnet Deployment...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy CarbonCreditToken
  console.log("📄 Deploying CarbonCreditToken...");
  const CarbonCreditToken = await hre.ethers.getContractFactory("CarbonCreditToken");
  const carbonToken = await CarbonCreditToken.deploy("https://gateway.pinata.cloud/ipfs/{id}");
  await carbonToken.waitForDeployment();
  const carbonTokenAddress = await carbonToken.getAddress();
  console.log("✅ CarbonCreditToken deployed to:", carbonTokenAddress);

  // Deploy CarbonOracle
  console.log("\n📄 Deploying CarbonOracle...");
  const CarbonOracle = await hre.ethers.getContractFactory("CarbonOracle");
  const carbonOracle = await CarbonOracle.deploy(carbonTokenAddress);
  await carbonOracle.waitForDeployment();
  const carbonOracleAddress = await carbonOracle.getAddress();
  console.log("✅ CarbonOracle deployed to:", carbonOracleAddress);

  // Deploy CarbonMarketplace
  console.log("\n📄 Deploying CarbonMarketplace...");
  const CarbonMarketplace = await hre.ethers.getContractFactory("CarbonMarketplace");
  const carbonMarketplace = await CarbonMarketplace.deploy(carbonTokenAddress);
  await carbonMarketplace.waitForDeployment();
  const carbonMarketplaceAddress = await carbonMarketplace.getAddress();
  console.log("✅ CarbonMarketplace deployed to:", carbonMarketplaceAddress);

  // Set up roles and permissions
  console.log("\n🔑 Setting up roles and permissions...");
  
  const MINTER_ROLE = await carbonToken.MINTER_ROLE();
  const VERIFIER_ROLE = await carbonToken.VERIFIER_ROLE();
  const ORACLE_ROLE = await carbonToken.ORACLE_ROLE();
  
  // Grant oracle role to CarbonOracle contract
  await carbonToken.grantRole(ORACLE_ROLE, carbonOracleAddress);
  console.log("✅ Granted ORACLE_ROLE to CarbonOracle");
  
  // Grant minter role to oracle (for automatic credit issuance)
  await carbonToken.grantRole(MINTER_ROLE, carbonOracleAddress);
  console.log("✅ Granted MINTER_ROLE to CarbonOracle");
  
  // Register deployer as data provider and verifier for testing
  const IOT_PROVIDER_ROLE = await carbonOracle.IOT_PROVIDER_ROLE();
  const AI_VERIFIER_ROLE = await carbonOracle.AI_VERIFIER_ROLE();
  
  await carbonOracle.grantRole(IOT_PROVIDER_ROLE, await deployer.getAddress());
  await carbonOracle.grantRole(AI_VERIFIER_ROLE, await deployer.getAddress());
  await carbonToken.grantRole(VERIFIER_ROLE, await deployer.getAddress());
  console.log("✅ Granted testing roles to deployer");

  // Create deployment summary
  const deploymentInfo = {
    network: hre.network.name,
    deployer: await deployer.getAddress(),
    deploymentTime: new Date().toISOString(),
    gasPrice: (await hre.ethers.provider.getFeeData()).gasPrice?.toString() || "0",
    blockNumber: await hre.ethers.provider.getBlockNumber(),
    contracts: {
      CarbonCreditToken: {
        address: carbonTokenAddress,
        deployer: await deployer.getAddress(),
        roles: {
          MINTER_ROLE: MINTER_ROLE,
          VERIFIER_ROLE: VERIFIER_ROLE,
          ORACLE_ROLE: ORACLE_ROLE
        }
      },
      CarbonOracle: {
        address: carbonOracleAddress,
        linkedToken: carbonTokenAddress,
        roles: {
          IOT_PROVIDER_ROLE: IOT_PROVIDER_ROLE,
          AI_VERIFIER_ROLE: AI_VERIFIER_ROLE
        }
      },
      CarbonMarketplace: {
        address: carbonMarketplaceAddress,
        linkedToken: carbonTokenAddress
      }
    }
  };

  // Save deployment info to file
  const deploymentPath = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  const filename = `${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentPath, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Update latest deployment
  fs.writeFileSync(
    path.join(deploymentPath, `${hre.network.name}-latest.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Create environment variables file
  const envVars = `
# Carbon Credit System - ${hre.network.name.toUpperCase()} Deployment
CARBON_TOKEN_ADDRESS=${carbonTokenAddress}
CARBON_ORACLE_ADDRESS=${carbonOracleAddress}
CARBON_MARKETPLACE_ADDRESS=${carbonMarketplaceAddress}
ETHEREUM_RPC_URL=${hre.network.config.url || 'http://127.0.0.1:8545'}
NETWORK_NAME=${hre.network.name}
DEPLOYER_ADDRESS=${await deployer.getAddress()}
DEPLOYMENT_TIME=${deploymentInfo.deploymentTime}
`;

  fs.writeFileSync(
    path.join(deploymentPath, `${hre.network.name}.env`),
    envVars.trim()
  );

  console.log("\n📊 Deployment Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer: ${await deployer.getAddress()}`);
  console.log(`Block Number: ${deploymentInfo.blockNumber}`);
  console.log(`Gas Price: ${hre.ethers.formatUnits(deploymentInfo.gasPrice, 'gwei')} gwei`);
  console.log("\n📄 Contract Addresses:");
  console.log(`CarbonCreditToken: ${carbonTokenAddress}`);
  console.log(`CarbonOracle: ${carbonOracleAddress}`);
  console.log(`CarbonMarketplace: ${carbonMarketplaceAddress}`);
  console.log("\n💾 Deployment info saved to:");
  console.log(`${path.join(deploymentPath, filename)}`);
  console.log(`${path.join(deploymentPath, `${hre.network.name}.env`)}`);

  // Run basic verification
  console.log("\n🔍 Running deployment verification...");
  
  try {
    // Test CarbonOracle
    const oracleToken = await carbonOracle.carbonToken();
    console.log(`✅ CarbonOracle linked to token: ${oracleToken}`);
    
    // Test CarbonMarketplace
    const marketplaceToken = await carbonMarketplace.carbonToken();
    console.log(`✅ CarbonMarketplace linked to token: ${marketplaceToken}`);
    
    // Test basic functionality
    const hasRole = await carbonToken.hasRole(ORACLE_ROLE, carbonOracleAddress);
    console.log(`✅ Oracle has proper role: ${hasRole}`);
    
    console.log("\n🎉 Deployment completed successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
  } catch (error) {
    console.error("\n❌ Verification failed:", error.message);
    throw error;
  }

  // Mint a test carbon credit for demonstration
  console.log("\n🧪 Creating test carbon credit...");
  try {
    const testCredit = await carbonToken.mintCarbonCredit(
      "TEST_PROJECT_001",
      "VERIFIED_CARBON_STANDARD",
      1000, // 1000 tons CO2 equivalent
      Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year expiry
      "QmTkzDwWqPbnAh5YiV5VwcTLnGdwSNsNTn2aDxdXBFca7D", // Test IPFS hash
      1000 // 1000 credits
    );
    
    await testCredit.wait();
    console.log("✅ Test carbon credit minted (Token ID: 1)");
    
    // Verify and activate the test credit
    await carbonToken.verifyCredit(1);
    await carbonToken.activateCredit(1);
    console.log("✅ Test credit verified and activated");
    
  } catch (error) {
    console.warn("⚠️  Test credit creation failed:", error.message);
  }

  console.log("\n🌱 Carbon Credit System deployed and ready!");
  console.log("You can now start the backend server and frontend application.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
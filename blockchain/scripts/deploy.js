const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Starting Carbon Credit System deployment...\n");
    
    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString(), "wei\n");
    
    // Deploy CarbonCreditToken
    console.log("📄 Deploying CarbonCreditToken...");
    const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
    const carbonToken = await CarbonCreditToken.deploy("https://api.carbon-credits.io/metadata/{id}.json");
    await carbonToken.deployed();
    console.log("✅ CarbonCreditToken deployed to:", carbonToken.address);
    
    // Deploy CarbonOracle
    console.log("\n🔮 Deploying CarbonOracle...");
    const CarbonOracle = await ethers.getContractFactory("CarbonOracle");
    const carbonOracle = await CarbonOracle.deploy(carbonToken.address);
    await carbonOracle.deployed();
    console.log("✅ CarbonOracle deployed to:", carbonOracle.address);
    
    // Deploy CarbonMarketplace
    console.log("\n🏪 Deploying CarbonMarketplace...");
    const CarbonMarketplace = await ethers.getContractFactory("CarbonMarketplace");
    const carbonMarketplace = await CarbonMarketplace.deploy(carbonToken.address);
    await carbonMarketplace.deployed();
    console.log("✅ CarbonMarketplace deployed to:", carbonMarketplace.address);
    
    // Grant necessary roles
    console.log("\n🔐 Setting up roles and permissions...");
    
    // Grant MINTER_ROLE to Oracle
    const MINTER_ROLE = await carbonToken.MINTER_ROLE();
    const VERIFIER_ROLE = await carbonToken.VERIFIER_ROLE();
    const ORACLE_ROLE = await carbonOracle.ORACLE_ROLE();
    const AI_VERIFIER_ROLE = await carbonOracle.AI_VERIFIER_ROLE();
    const IOT_PROVIDER_ROLE = await carbonOracle.IOT_PROVIDER_ROLE();
    
    await carbonToken.grantRole(MINTER_ROLE, carbonOracle.address);
    console.log("✅ Granted MINTER_ROLE to Oracle");
    
    await carbonToken.grantRole(VERIFIER_ROLE, carbonOracle.address);
    console.log("✅ Granted VERIFIER_ROLE to Oracle");
    
    // Grant roles to deployer for testing
    await carbonOracle.grantRole(ORACLE_ROLE, deployer.address);
    console.log("✅ Granted ORACLE_ROLE to deployer");
    
    await carbonOracle.grantRole(AI_VERIFIER_ROLE, deployer.address);
    console.log("✅ Granted AI_VERIFIER_ROLE to deployer");
    
    await carbonOracle.grantRole(IOT_PROVIDER_ROLE, deployer.address);
    console.log("✅ Granted IOT_PROVIDER_ROLE to deployer");
    
    // Verify deployment by checking basic functionality
    console.log("\n🧪 Verifying deployment...");
    
    try {
        // Test Oracle data submission
        const tx = await carbonOracle.submitEmissionData(
            "sensor-001",
            400, // 400 ppm CO2
            0x0, // encoded location (simplified for test)
            "QmTest123" // IPFS hash of sensor data
        );
        await tx.wait();
        console.log("✅ Oracle data submission test passed");
        
        // Test getting active credits (should be empty)
        const activeCredits = await carbonToken.getActiveCredits();
        console.log("✅ Active credits query test passed (count:", activeCredits.length, ")");
        
    } catch (error) {
        console.log("⚠️  Verification test failed:", error.message);
    }
    
    // Save deployment addresses
    const deploymentInfo = {
        network: await ethers.provider.getNetwork(),
        deployer: deployer.address,
        contracts: {
            CarbonCreditToken: carbonToken.address,
            CarbonOracle: carbonOracle.address,
            CarbonMarketplace: carbonMarketplace.address
        },
        roles: {
            MINTER_ROLE: MINTER_ROLE,
            VERIFIER_ROLE: VERIFIER_ROLE,
            ORACLE_ROLE: ORACLE_ROLE,
            AI_VERIFIER_ROLE: AI_VERIFIER_ROLE,
            IOT_PROVIDER_ROLE: IOT_PROVIDER_ROLE
        },
        timestamp: new Date().toISOString()
    };
    
    // Log deployment summary
    console.log("\n📋 DEPLOYMENT SUMMARY");
    console.log("=====================");
    console.log("Network:", deploymentInfo.network.name, "(Chain ID:", deploymentInfo.network.chainId, ")");
    console.log("Deployer:", deploymentInfo.deployer);
    console.log("\nContract Addresses:");
    console.log("- CarbonCreditToken:", deploymentInfo.contracts.CarbonCreditToken);
    console.log("- CarbonOracle:", deploymentInfo.contracts.CarbonOracle);
    console.log("- CarbonMarketplace:", deploymentInfo.contracts.CarbonMarketplace);
    
    console.log("\n🎉 Deployment completed successfully!");
    console.log("\n💡 Next steps:");
    console.log("1. Update your .env file with the contract addresses");
    console.log("2. Set up IoT sensors to submit data to the Oracle");
    console.log("3. Configure AI verification service");
    console.log("4. Start the backend API server");
    console.log("5. Launch the frontend application");
    
    return deploymentInfo;
}

// Handle deployment errors
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Deployment failed:", error);
        process.exit(1);
    });
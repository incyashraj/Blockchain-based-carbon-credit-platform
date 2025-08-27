require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Only use environment variables if they are valid (not placeholder text)
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL?.includes('YOUR_INFURA_KEY') ? null : process.env.ETHEREUM_RPC_URL;
const HEDERA_PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY?.includes('YOUR_HEDERA_PRIVATE_KEY') ? null : process.env.HEDERA_PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    sepolia: {
      url: ETHEREUM_RPC_URL || "https://sepolia.infura.io/v3/",
      accounts: HEDERA_PRIVATE_KEY ? [HEDERA_PRIVATE_KEY] : ["0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]
    },
    polygon_amoy: {
      url: "https://rpc-amoy.polygon.technology/",
      accounts: HEDERA_PRIVATE_KEY ? [HEDERA_PRIVATE_KEY] : ["0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      chainId: 80002,
      gasPrice: 30000000000, // 30 gwei (minimum required)
      gas: 5000000
    },
    polygon_mainnet: {
      url: "https://polygon-rpc.com",
      accounts: HEDERA_PRIVATE_KEY ? [HEDERA_PRIVATE_KEY] : ["0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      chainId: 137,
      gasPrice: 30000000000
    },
    arbitrum_sepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: HEDERA_PRIVATE_KEY ? [HEDERA_PRIVATE_KEY] : ["0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      chainId: 421614
    },
    base_sepolia: {
      url: "https://sepolia.base.org",
      accounts: HEDERA_PRIVATE_KEY ? [HEDERA_PRIVATE_KEY] : ["0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      chainId: 84532
    }
  },
  paths: {
    sources: "./blockchain/contracts",
    tests: "./blockchain/test",
    cache: "./blockchain/cache",
    artifacts: "./blockchain/artifacts"
  }
};
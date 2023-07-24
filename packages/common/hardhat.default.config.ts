import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'path'
dotenvConfig({ path: resolve(__dirname, '../../.env') })

import { HardhatUserConfig, SolcUserConfig } from 'hardhat/types'
import { NetworkUserConfig } from 'hardhat/types'

import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-network-helpers'
import '@nomiclabs/hardhat-etherscan'
import 'solidity-coverage'
import 'hardhat-gas-reporter'
import 'hardhat-contract-sizer'
import 'hardhat-deploy'
import 'hardhat-dependency-compiler'
import { getChainId, isArbitrum, isBase, isOptimism, SupportedChain } from './testutil/network'

export const SOLIDITY_VERSION = '0.8.17'
const PRIVATE_KEY_MAINNET = process.env.PRIVATE_KEY || ''
const PRIVATE_KEY_TESTNET = process.env.PRIVATE_KEY_TESTNET || ''

const ETHERSCAN_API_KEY_MAINNET = process.env.ETHERSCAN_API_KEY_MAINNET || ''
const ETHERSCAN_API_KEY_OPTIMISM = process.env.ETHERSCAN_API_KEY_OPTIMISM || ''
const ETHERSCAN_API_KEY_ARBITRUM = process.env.ETHERSCAN_API_KEY_ARBITRUM || ''
const ETHERSCAN_API_KEY_BASE = process.env.ETHERSCAN_API_KEY_BASE || ''

const MAINNET_NODE_URL = process.env.MAINNET_NODE_URL || ''
const OPTIMISM_NODE_URL = process.env.OPTIMISM_NODE_URL || ''
const ARBITRUM_NODE_URL = process.env.ARBITRUM_NODE_URL || ''
const BASE_NODE_URL = process.env.BASE_NODE_URL || ''

const GOERLI_NODE_URL = process.env.GOERLI_NODE_URL || ''
const OPTIMISM_GOERLI_NODE_URL = process.env.OPTIMISM_GOERLI_NODE_URL || ''
const ARBITRUM_GOERLI_NODE_URL = process.env.ARBITRUM_GOERLI_NODE_URL || ''
const BASE_GOERLI_NODE_URL = process.env.BASE_GOERLI_NODE_URL || ''

export const FORK_ENABLED = process.env.FORK_ENABLED === 'true' || false
export const FORK_NETWORK = process.env.FORK_NETWORK || 'mainnet'
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined
const FORK_USE_REAL_DEPLOYS = process.env.FORK_USE_REAL_DEPLOYS === 'true' || false

const NODE_INTERVAL_MINING = process.env.NODE_INTERVAL_MINING ? parseInt(process.env.NODE_INTERVAL_MINING) : undefined

const MOCHA_PARALLEL = process.env.MOCHA_PARALLEL === 'true' || false
const MOCHA_REPORTER = process.env.MOCHA_REPORTER || 'spec'

export const OPTIMIZER_ENABLED = process.env.OPTIMIZER_ENABLED === 'true' || false

function getUrl(networkName: SupportedChain): string {
  switch (networkName) {
    case 'mainnet':
      return MAINNET_NODE_URL
    case 'arbitrum':
      return ARBITRUM_NODE_URL
    case 'optimism':
      return OPTIMISM_NODE_URL
    case 'base':
      return BASE_NODE_URL
    case 'goerli':
      return GOERLI_NODE_URL
    case 'optimismGoerli':
      return OPTIMISM_GOERLI_NODE_URL
    case 'arbitrumGoerli':
      return ARBITRUM_GOERLI_NODE_URL
    case 'baseGoerli':
      return BASE_GOERLI_NODE_URL
    default:
      return ''
  }
}

function getEtherscanApiConfig(networkName: SupportedChain): { apiKey: string; apiUrl?: string } {
  if (isOptimism(networkName)) return { apiKey: ETHERSCAN_API_KEY_OPTIMISM }
  if (isArbitrum(networkName)) return { apiKey: ETHERSCAN_API_KEY_ARBITRUM }
  if (isBase(networkName)) return { apiKey: ETHERSCAN_API_KEY_BASE, apiUrl: 'https://api-goerli.basescan.org' } // no API key required

  return { apiKey: ETHERSCAN_API_KEY_MAINNET }
}

function createNetworkConfig(network: SupportedChain): NetworkUserConfig {
  const cfg = {
    accounts: PRIVATE_KEY_TESTNET ? [PRIVATE_KEY_TESTNET] : [],
    chainId: getChainId(network),
    url: getUrl(network),
    verify: {
      etherscan: getEtherscanApiConfig(network),
    },
  }

  if (network === 'mainnet') {
    cfg.accounts = PRIVATE_KEY_MAINNET ? [PRIVATE_KEY_MAINNET] : []
  }

  return cfg
}
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
type configOverrides = {
  solidityOverrides?: Record<string, SolcUserConfig>
  externalDeployments?: { [networkName: string]: string[] }
  dependencyPaths?: string[]
  solidityVersion?: string
}

export default function defaultConfig({
  solidityOverrides,
  externalDeployments,
  dependencyPaths,
  solidityVersion,
}: configOverrides = {}): HardhatUserConfig {
  return {
    defaultNetwork: 'hardhat',
    networks: {
      hardhat: {
        forking: {
          url: getUrl(FORK_NETWORK as SupportedChain),
          enabled: FORK_ENABLED,
          blockNumber: FORK_BLOCK_NUMBER,
        },
        chainId: getChainId('hardhat'),
        allowUnlimitedContractSize: true,
        mining: NODE_INTERVAL_MINING
          ? {
              interval: NODE_INTERVAL_MINING,
            }
          : undefined,
      },
      goerli: createNetworkConfig('goerli'),
      arbitrumGoerli: createNetworkConfig('arbitrumGoerli'),
      optimismGoerli: createNetworkConfig('optimismGoerli'),
      baseGoerli: createNetworkConfig('baseGoerli'),
      mainnet: createNetworkConfig('mainnet'),
      arbitrum: createNetworkConfig('arbitrum'),
      optimism: createNetworkConfig('optimism'),
      // base: createNetworkConfig('base'),
    },
    solidity: {
      compilers: [
        {
          version: solidityVersion || SOLIDITY_VERSION,
          settings: {
            optimizer: {
              enabled: OPTIMIZER_ENABLED,
              runs: 1000000, // Max allowed by Etherscan verify
            },
            outputSelection: OPTIMIZER_ENABLED
              ? {}
              : {
                  '*': {
                    '*': ['storageLayout'], // This is needed by Smock for mocking functions
                  },
                },
          },
        },
      ],
      overrides: solidityOverrides,
    },
    dependencyCompiler: {
      paths: dependencyPaths,
    },
    namedAccounts: {
      deployer: 0,
    },
    etherscan: {
      apiKey: {
        mainnet: getEtherscanApiConfig('mainnet').apiKey,
        optimisticEthereum: getEtherscanApiConfig('optimism').apiKey,
        arbitrumOne: getEtherscanApiConfig('arbitrum').apiKey,
        base: getEtherscanApiConfig('base').apiKey,
        goerli: getEtherscanApiConfig('goerli').apiKey,
        optimisticGoerli: getEtherscanApiConfig('optimismGoerli').apiKey,
        arbitrumGoerli: getEtherscanApiConfig('arbitrumGoerli').apiKey,
        baseGoerli: getEtherscanApiConfig('baseGoerli').apiKey,
      },
    },
    gasReporter: {
      currency: 'USD',
      gasPrice: 100,
      enabled: process.env.REPORT_GAS ? true : false,
    },
    typechain: {
      outDir: 'types/generated',
      target: 'ethers-v5',
    },
    mocha: {
      parallel: MOCHA_PARALLEL,
      reporter: MOCHA_REPORTER,
      slow: 1000,
      timeout: 2400000,
    },
    contractSizer: {
      alphaSort: true,
      disambiguatePaths: false,
      runOnCompile: true,
      strict: false,
    },
    external: {
      contracts: [{ artifacts: 'external/contracts' }],
      deployments: {
        kovan: ['external/deployments/kovan', ...(externalDeployments?.kovan || [])],
        goerli: ['external/deployments/goerli', ...(externalDeployments?.goerli || [])],
        mainnet: ['external/deployments/mainnet', ...(externalDeployments?.mainnet || [])],
        arbitrum: ['external/deployments/arbitrum', ...(externalDeployments?.arbitrum || [])],
        optimism: ['external/deployments/optimism', ...(externalDeployments?.optimism || [])],
        base: ['external/deployments/base', ...(externalDeployments?.base || [])],
        arbitrumGoerli: ['external/deployments/arbitrumGoerli', ...(externalDeployments?.arbitrumGoerli || [])],
        optimismGoerli: ['external/deployments/optimismGoerli', ...(externalDeployments?.optimismGoerli || [])],
        baseGoerli: ['external/deployments/baseGoerli', ...(externalDeployments?.baseGoerli || [])],
        hardhat: [
          FORK_ENABLED ? `external/deployments/${FORK_NETWORK}` : '',
          FORK_ENABLED && FORK_USE_REAL_DEPLOYS ? `deployments/${FORK_NETWORK}` : '',
          ...(externalDeployments?.hardhat || []),
        ],
        localhost: [
          FORK_ENABLED ? `external/deployments/${FORK_NETWORK}` : '',
          FORK_ENABLED && FORK_USE_REAL_DEPLOYS ? `deployments/${FORK_NETWORK}` : '',
          ...(externalDeployments?.localhost || []),
        ],
      },
    },
  }
}

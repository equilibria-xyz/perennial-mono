import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'path'
dotenvConfig({ path: resolve(__dirname, '../../.env') })

import { HardhatUserConfig, SolcUserConfig } from 'hardhat/types'
import { NetworkUserConfig } from 'hardhat/types'

import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'
import 'solidity-coverage'
import 'hardhat-gas-reporter'
import 'hardhat-contract-sizer'
import 'hardhat-deploy'
import 'hardhat-dependency-compiler'
import { getChainId } from './testutil/network'

export const SOLIDITY_VERSION = '0.8.15'
const PRIVATE_KEY_MAINNET = process.env.PRIVATE_KEY || ''
const PRIVATE_KEY_TESTNET = process.env.PRIVATE_KEY_TESTNET || ''
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || ''
const ALCHEMY_MAINNET = process.env.ALCHEMY_MAINNET || ''
const ALCHEMY_ROPSTEN = process.env.ALCHEMY_ROPSTEN || ''
const ALCHEMY_KOVAN = process.env.ALCHEMY_KOVAN || ''
const ALCHEMY_GOERLI = process.env.ALCHEMY_GOERLI || ''
const OPTIMISM_GOERLI_URL = process.env.OPTIMISM_GOERLI_URL || ''
const FORK_ENABLED = process.env.FORK_ENABLED === 'true' || false
const FORK_NETWORK = process.env.FORK_NETWORK || 'mainnet'
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined
const NODE_INTERVAL_MINING = process.env.NODE_INTERVAL_MINING ? parseInt(process.env.NODE_INTERVAL_MINING) : undefined
const MOCHA_PARALLEL = process.env.MOCHA_PARALLEL === 'true' || false
const MOCHA_REPORTER = process.env.MOCHA_REPORTER || 'spec'
export const OPTIMIZER_ENABLED = process.env.OPTIMIZER_ENABLED === 'true' || false

function getUrl(networkName: string): string {
  switch (networkName) {
    case 'mainnet':
    case 'mainnet-fork':
      return ALCHEMY_MAINNET
    case 'ropsten':
      return ALCHEMY_ROPSTEN
    case 'kovan':
      return ALCHEMY_KOVAN
    case 'goerli':
      return ALCHEMY_GOERLI
    case 'optimismGoerli':
      return OPTIMISM_GOERLI_URL
    default:
      return ''
  }
}

function createNetworkConfig(network: string): NetworkUserConfig {
  const cfg = {
    accounts: PRIVATE_KEY_TESTNET ? [PRIVATE_KEY_TESTNET] : [],
    chainId: getChainId(network),
    url: getUrl(network),
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
}

export default function defaultConfig({
  solidityOverrides,
  externalDeployments,
  dependencyPaths,
}: configOverrides = {}): HardhatUserConfig {
  return {
    defaultNetwork: 'hardhat',
    networks: {
      hardhat: {
        forking: {
          url: getUrl(FORK_NETWORK),
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
      kovan: createNetworkConfig('kovan'),
      rinkeby: createNetworkConfig('rinkeby'),
      ropsten: createNetworkConfig('ropsten'),
      mainnet: createNetworkConfig('mainnet'),
      optimismGoerli: createNetworkConfig('optimismGoerli'),
    },
    solidity: {
      compilers: [
        {
          version: SOLIDITY_VERSION,
          settings: {
            optimizer: {
              enabled: OPTIMIZER_ENABLED,
              runs: 1000000, // Max allowed by Etherscan verify
            },
            outputSelection: OPTIMIZER_ENABLED
              ? {}
              : {
                  '*': {
                    '*': ['storageLayout'],
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
      apiKey: ETHERSCAN_API_KEY,
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
      timeout: 120000,
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
        optimismGoerli: ['external/deployments/optimismGoerli', ...(externalDeployments?.optimismGoerli || [])],
        hardhat: [FORK_ENABLED ? `external/deployments/${FORK_NETWORK}` : '', ...(externalDeployments?.hardhat || [])],
        localhost: [
          FORK_ENABLED ? `external/deployments/${FORK_NETWORK}` : '',
          ...(externalDeployments?.localhost || []),
        ],
      },
    },
  }
}

import { task } from 'hardhat/config'

import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'path'
dotenvConfig({ path: resolve(__dirname, './.env') })

import { HardhatUserConfig } from 'hardhat/types'
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
import { getChainId } from './test/testutil/network'

const PRIVATE_KEY_MAINNET = process.env.PRIVATE_KEY || ''
const PRIVATE_KEY_TESTNET = process.env.PRIVATE_KEY_TESTNET || ''
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || ''
const ALCHEMY_MAINNET = process.env.ALCHEMY_MAINNET || ''
const ALCHEMY_ROPSTEN = process.env.ALCHEMY_ROPSTEN || ''
const ALCHEMY_KOVAN = process.env.ALCHEMY_KOVAN || ''
const FORK_ENABLED = process.env.FORK_ENABLED === 'true' || false
const FORK_NETWORK = process.env.FORK_NETWORK || 'mainnet'
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined
const MOCHA_PARALLEL = process.env.MOCHA_PARALLEL === 'true' || false
const MOCHA_REPORTER = process.env.MOCHA_REPORTER || 'spec'

function getUrl(networkName: string): string {
  switch (networkName) {
    case 'mainnet':
    case 'mainnet-fork':
      return ALCHEMY_MAINNET
    case 'ropsten':
      return ALCHEMY_ROPSTEN
    case 'kovan':
      return ALCHEMY_KOVAN
    default:
      return ''
  }
}

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (args, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    console.log(await account.address)
  }
})

function createTestnetConfig(network: string): NetworkUserConfig {
  return {
    accounts: PRIVATE_KEY_TESTNET ? [PRIVATE_KEY_TESTNET] : [],
    chainId: getChainId(network),
    url: getUrl(network),
  }
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
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
    },
    goerli: createTestnetConfig('goerli'),
    kovan: createTestnetConfig('kovan'),
    rinkeby: createTestnetConfig('rinkeby'),
    ropsten: createTestnetConfig('ropsten'),
    mainnet: {
      chainId: getChainId('mainnet'),
      url: getUrl('mainnet'),
      accounts: PRIVATE_KEY_MAINNET ? [PRIVATE_KEY_MAINNET] : [],
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.13',
        settings: {
          optimizer: {
            enabled: false,
            runs: 1000,
          },
          outputSelection: {
            '*': {
              '*': ['storageLayout'],
            },
          },
        },
      },
    ],
  },
  dependencyCompiler: {
    paths: [
      '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
      '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    ],
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
    timeout: 60000,
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
      mainnet: ['external/deployments/mainnet'],
      hardhat: [FORK_ENABLED ? 'external/deployments/mainnet' : ''],
    },
  },
}

export default config

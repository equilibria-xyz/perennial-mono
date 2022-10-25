import { dirname } from 'path'

import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'
const eqPerennialOracleDir = dirname(require.resolve('@equilibria/perennial-oracle/package.json'))

// This Solidity config produces small contract sizes, and is useful when
// contracts are close to the maximum possible size. The trade off is each
// function call will likely use extra gas.
// Mostly inspired by Compound Comet's setup: https://github.com/compound-finance/comet/blob/main/hardhat.config.ts#L124
const MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES = {
  version: SOLIDITY_VERSION,
  settings: {
    viaIR: OPTIMIZER_ENABLED,
    optimizer: OPTIMIZER_ENABLED
      ? {
          enabled: true,
          runs: 1,
          details: {
            yulDetails: {
              // We checked with the Compound team to confirm that this should be safe to use to other projects
              optimizerSteps:
                'dhfoDgvulfnTUtnIf [xa[r]scLM cCTUtTOntnfDIul Lcul Vcul [j] Tpeul xa[rul] xa[r]cL gvif CTUca[r]LsTOtfDnca[r]Iulc] jmul[jul] VcTOcul jmul',
            },
          },
        }
      : { enabled: false },
    outputSelection: OPTIMIZER_ENABLED
      ? {
          '*': {
            '*': ['evm.deployedBytecode.sourceMap'],
          },
        }
      : {
          '*': {
            '*': ['storageLayout'], // This is needed by Smock for mocking functions
          },
        },
  },
}

const config = defaultConfig({
  solidityOverrides: {
    'contracts/product/Product.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
    'contracts/lens/PerennialLens.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
  },
  externalDeployments: {
    kovan: [`${eqPerennialOracleDir}/deployments/kovan`],
    goerli: [`${eqPerennialOracleDir}/deployments/goerli`],
    mainnet: [`${eqPerennialOracleDir}/deployments/mainnet`],
    hardhat: [`${eqPerennialOracleDir}/deployments/mainnet`],
    localhost: [`${eqPerennialOracleDir}/deployments/localhost`],
  },
  dependencyPaths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol',
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol',
    '@equilibria/perennial-oracle/contracts/ChainlinkOracle.sol',
    '@equilibria/perennial-oracle/contracts/ReservoirFeedOracle.sol',
    '@equilibria/perennial-oracle/contracts/test/TestnetChainlinkFeedRegistry.sol',
    '@equilibria/perennial-oracle/contracts/test/PassthroughDataFeed.sol',
    '@equilibria/perennial-oracle/contracts/test/PassthroughChainlinkFeed.sol',
    '@equilibria/emptyset-batcher/batcher/Batcher.sol',
  ],
})

export default config

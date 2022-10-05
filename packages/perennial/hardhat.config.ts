import { dirname } from 'path'

import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'
const eqPerennialOracleDir = dirname(require.resolve('@equilibria/perennial-oracle/package.json'))

const config = defaultConfig({
  solidityOverrides: {
    'contracts/product/Product.sol': {
      version: SOLIDITY_VERSION,
      settings: {
        optimizer: {
          enabled: OPTIMIZER_ENABLED,
          runs: 5800, // Maximum value as of commit e6b7ab7
        },
      },
    },
  },
  externalDeployments: {
    kovan: [`${eqPerennialOracleDir}/deployments/kovan`],
    goerli: [`${eqPerennialOracleDir}/deployments/goerli`],
    mainnet: [`${eqPerennialOracleDir}/deployments/mainnet`],
    hardhat: [`${eqPerennialOracleDir}/deployments/mainnet`],
    optimismGoerli: [`${eqPerennialOracleDir}/deployments/optimismGoerli`],
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

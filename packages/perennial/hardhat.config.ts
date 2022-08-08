import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig()
config.dependencyCompiler = {
  paths: [
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
}

export default config

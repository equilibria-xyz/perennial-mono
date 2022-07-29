import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig()
config.dependencyCompiler = {
  paths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol',
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol',
    '@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol',
    '@equilibria/emptyset-batcher/batcher/Batcher.sol',
  ],
}

export default config

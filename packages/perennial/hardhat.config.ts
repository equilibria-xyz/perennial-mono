import defaultConfig, { OPTIMIZER_ENABLED, SOLIDITY_VERSION } from '../common/hardhat.default.config'

const config = defaultConfig({
  solidityOverrides: {
    'contracts/Market.sol': {
      version: SOLIDITY_VERSION,
      settings: {
        optimizer: {
          enabled: OPTIMIZER_ENABLED,
          runs: 100000, // Maximum value as of commit e6b7ab7
        },
        viaIR: true,
      },
    },
  },
  dependencyPaths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
    '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol',
    '@openzeppelin/contracts/governance/TimelockController.sol',
    '@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol',
    '@equilibria/emptyset-batcher/batcher/Batcher.sol',
  ],
})

export default config

import defaultConfig from '../common/hardhat.default.config'
const config = defaultConfig()
config.dependencyCompiler = {
  paths: [
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
    '@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol',
  ],
}

export default config

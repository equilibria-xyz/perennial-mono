import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig()
config.dependencyCompiler = {
  paths: ['@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol'],
}

export default config

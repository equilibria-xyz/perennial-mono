import defaultConfig from '../common/hardhat.default.config'

import './tasks'

const config = defaultConfig({
  dependencyPaths: ['@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol'],
})

export default config

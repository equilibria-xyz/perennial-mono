import { dirname } from 'path'
import defaultConfig from '../common/hardhat.default.config'
const eqPerennialDir = dirname(require.resolve('@equilibria/perennial/package.json'))

const config = defaultConfig()
config.dependencyCompiler = {
  paths: ['@equilibria/perennial/contracts/interfaces/IController.sol'],
}

config.external = {
  contracts: [{ artifacts: 'external/contracts' }],
  deployments: {
    kovan: [...(config.external?.deployments?.kovan || []), `${eqPerennialDir}/deployments/kovan`],
    mainnet: [...(config.external?.deployments?.mainnet || []), `${eqPerennialDir}/deployments/mainnet`],
    hardhat: [...(config.external?.deployments?.hardhat || []), `${eqPerennialDir}/deployments/mainnet`],
    localhost: [...(config.external?.deployments?.localhost || []), `${eqPerennialDir}/deployments/localhost`],
  },
}

export default config

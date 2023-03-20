import { dirname } from 'path'

import defaultConfig from '../common/hardhat.default.config'
const eqPerennialDir = dirname(require.resolve('@equilibria/perennial/package.json'))
const eqPerennialOracleDir = dirname(require.resolve('@equilibria/perennial-oracle/package.json'))

const config = defaultConfig({
  externalDeployments: {
    kovan: [`${eqPerennialDir}/deployments/kovan`, `${eqPerennialOracleDir}/deployments/kovan`],
    goerli: [`${eqPerennialDir}/deployments/goerli`, `${eqPerennialOracleDir}/deployments/goerli`],
    arbitrumGoerli: [
      `${eqPerennialDir}/deployments/arbitrumGoerli`,
      `${eqPerennialOracleDir}/deployments/arbitrumGoerli`,
    ],
    optimismGoerli: [
      `${eqPerennialDir}/deployments/optimismGoerli`,
      `${eqPerennialOracleDir}/deployments/optimismGoerli`,
    ],
    baseGoerli: [`${eqPerennialDir}/deployments/baseGoerli`, `${eqPerennialOracleDir}/deployments/baseGoerli`],
    mainnet: [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialOracleDir}/deployments/mainnet`],
    arbitrum: [`${eqPerennialDir}/deployments/arbitrum`, `${eqPerennialOracleDir}/deployments/arbitrum`],
    optimism: [`${eqPerennialDir}/deployments/optimism`, `${eqPerennialOracleDir}/deployments/optimism`],
    base: [`${eqPerennialDir}/deployments/base`, `${eqPerennialOracleDir}/deployments/base`],
    hardhat: [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialOracleDir}/deployments/mainnet`],
    localhost: [`${eqPerennialDir}/deployments/localhost`, `${eqPerennialOracleDir}/deployments/localhost`],
  },
  dependencyPaths: ['@equilibria/perennial/contracts/interfaces/IController.sol'],
})

export default config

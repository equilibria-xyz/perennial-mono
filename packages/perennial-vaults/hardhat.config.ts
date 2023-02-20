import { dirname } from 'path'

import defaultConfig, { FORK_ENABLED, FORK_NETWORK } from '../common/hardhat.default.config'
const eqPerennialDir = dirname(require.resolve('@equilibria/perennial/package.json'))

const config = defaultConfig({
  solidityVersion: '0.8.17',
  externalDeployments: {
    kovan: [`${eqPerennialDir}/deployments/kovan`, `${eqPerennialDir}/external/deployments/kovan`],
    goerli: [`${eqPerennialDir}/deployments/goerli`, `${eqPerennialDir}/external/deployments/goerli`],
    mainnet: [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialDir}/external/deployments/mainnet`],
    arbitrumGoerli: [
      `${eqPerennialDir}/deployments/arbitrumGoerli`,
      `${eqPerennialDir}/external/deployments/arbitrumGoerli`,
    ],
    arbitrum: [`${eqPerennialDir}/deployments/arbitrum`, `${eqPerennialDir}/external/deployments/arbitrum`],
    hardhat: FORK_ENABLED
      ? [`${eqPerennialDir}/deployments/${FORK_NETWORK}`, `${eqPerennialDir}/external/deployments/${FORK_NETWORK}`]
      : [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialDir}/external/deployments/mainnet`],
    localhost: [`${eqPerennialDir}/deployments/localhost`, `${eqPerennialDir}/external/deployments/localhost`],
  },
  dependencyPaths: [
    '@equilibria/perennial/contracts/interfaces/IController.sol',
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
  ],
})

export default config

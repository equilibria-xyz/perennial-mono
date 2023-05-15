import { dirname } from 'path'

import defaultConfig, { OPTIMIZER_ENABLED, FORK_ENABLED, FORK_NETWORK } from '../common/hardhat.default.config'
const eqPerennialDir = dirname(require.resolve('@equilibria/perennial/package.json'))

const MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES = {
  version: '0.8.17',
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 1,
      details: {
        yulDetails: {
          // We checked with the Compound team to confirm that this should be safe to use to other projects
          optimizerSteps:
            'dhfoDgvulfnTUtnIf [xa[r]scLM cCTUtTOntnfDIul Lcul Vcul [j] Tpeul xa[rul] xa[r]cL gvif CTUca[r]LsTOtfDnca[r]Iulc] jmul[jul] VcTOcul jmul',
        },
      },
    },
    outputSelection: OPTIMIZER_ENABLED
      ? {
          '*': {
            '*': ['evm.deployedBytecode.sourceMap'],
          },
        }
      : {
          '*': {
            '*': ['storageLayout'], // This is needed by Smock for mocking functions
          },
        },
  },
}

const config = defaultConfig({
  solidityOverrides: {
    'contracts/balanced/BalancedVault.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
    'contracts/balanced/BalancedVaultDefinition.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
    'contracts/balanced/types/MarketAccount.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
    'contracts/balanced/types/MarketDefinition.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
    'contracts/PerennialLib.sol': MINIMUM_CONTRACT_SIZE_SOLIDITY_OVERRIDES,
  },
  externalDeployments: {
    goerli: [`${eqPerennialDir}/deployments/goerli`, `${eqPerennialDir}/external/deployments/goerli`],
    mainnet: [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialDir}/external/deployments/mainnet`],
    arbitrumGoerli: [
      `${eqPerennialDir}/deployments/arbitrumGoerli`,
      `${eqPerennialDir}/external/deployments/arbitrumGoerli`,
    ],
    arbitrum: [`${eqPerennialDir}/deployments/arbitrum`, `${eqPerennialDir}/external/deployments/arbitrum`],
    baseGoerli: [`${eqPerennialDir}/deployments/baseGoerli`, `${eqPerennialDir}/external/deployments/baseGoerli`],
    base: [`${eqPerennialDir}/deployments/base`, `${eqPerennialDir}/external/deployments/base`],
    hardhat: FORK_ENABLED
      ? [`${eqPerennialDir}/deployments/${FORK_NETWORK}`, `${eqPerennialDir}/external/deployments/${FORK_NETWORK}`]
      : [`${eqPerennialDir}/deployments/mainnet`, `${eqPerennialDir}/external/deployments/mainnet`],
    localhost: [`${eqPerennialDir}/deployments/localhost`, `${eqPerennialDir}/external/deployments/localhost`],
  },
  dependencyPaths: [
    '@equilibria/perennial/contracts/interfaces/IController.sol',
    '@equilibria/perennial-oracle/contracts/ChainlinkOracle.sol',
    '@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol',
  ],
})

export default config

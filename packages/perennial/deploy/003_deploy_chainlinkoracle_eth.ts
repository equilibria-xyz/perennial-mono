import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { CHAINLINK_CUSTOM_CURRENCIES } from '../test/integration/helpers/chainlinkHelpers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  const chainlinkRegistryAddress =
    (await getOrNull('ChainlinkFeedRegistry'))?.address || (await get('TestnetChainlinkFeedRegistry')).address

  console.log('using ChainlinkFeedRegistry address: ' + chainlinkRegistryAddress)

  // ORACLE

  await deploy('ChainlinkOracle_ETH', {
    contract: 'ChainlinkOracle',
    args: [chainlinkRegistryAddress, CHAINLINK_CUSTOM_CURRENCIES.ETH, CHAINLINK_CUSTOM_CURRENCIES.USD],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
}

export default func
func.tags = ['Examples']

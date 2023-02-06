import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { CHAINLINK_CUSTOM_CURRENCIES } from '../util'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  const chainlinkRegistryAddress =
    (await getOrNull('ChainlinkFeedRegistry'))?.address || (await getOrNull('TestnetChainlinkFeedRegistry'))?.address

  // ORACLE

  // If there is no FeedRegistry, deploy a passthrough datafeed as oracle instead
  if (!chainlinkRegistryAddress) {
    console.log('No ChainlinkFeedRegistry found. Using passthrough data feed!')
    const chainlinkETHUSDDataFeedAddress = (await getOrNull('ChainlinkDataFeedETHUSD'))?.address

    if (chainlinkETHUSDDataFeedAddress == null) {
      console.log('no deployment found for ChainlinkDataFeedETHUSD')
      return
    }

    console.log('using ChainlinkDataFeedETHUSD address: ' + chainlinkETHUSDDataFeedAddress)

    // ORACLE

    await deploy('ChainlinkOracle_ETH', {
      contract: 'ChainlinkFeedOracle',
      args: [chainlinkETHUSDDataFeedAddress],
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })

    return
  }

  console.log('using ChainlinkFeedRegistry address: ' + chainlinkRegistryAddress)

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
func.tags = ['OracleETH']

import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { CHAINLINK_CUSTOM_CURRENCIES } from '../util'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  // Goerli doesn't have a ChainlinkFeedRegistry yet, so just deploy a passthrough datafeed as oracle instead
  if (isGoerli(getNetworkName())) {
    console.log('Detected Goerli network. Using passthrough data feed!')
    const chainlinkETHUSDDataFeedAddress = (await getOrNull('ChainlinkDataFeedETHUSD'))?.address

    if (chainlinkETHUSDDataFeedAddress == null) {
      console.log('no deployment found for ChainlinkDataFeedETHUSD')
      return
    }

    console.log('using ChainlinkDataFeedETHUSD address: ' + chainlinkETHUSDDataFeedAddress)

    // ORACLE

    await deploy('ChainlinkOracle_ETH', {
      contract: 'ReservoirFeedOracle',
      args: [chainlinkETHUSDDataFeedAddress, hre.ethers.BigNumber.from('18446744073709556730')],
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })

    return
  }

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

function isGoerli(networkName: string) {
  return networkName === 'goerli' || (networkName === 'localhost' && process.env.FORK_NETWORK === 'goerli')
}

export default func
func.tags = ['OracleETH']

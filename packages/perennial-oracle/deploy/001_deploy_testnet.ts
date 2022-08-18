import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // ChainlinkFeedRegistry
  if ((await getOrNull('ChainlinkFeedRegistry')) == null) {
    await deploy('TestnetChainlinkFeedRegistry', {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }
}

export default func
func.tags = ['Testnet']

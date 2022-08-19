import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // DSU
  if ((await getOrNull('DSU')) == null) {
    await deploy('TestnetDSU', {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }

  // USDC
  if ((await getOrNull('USDC')) == null) {
    await deploy('TestnetUSDC', {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }
}

export default func
func.tags = ['Testnet']

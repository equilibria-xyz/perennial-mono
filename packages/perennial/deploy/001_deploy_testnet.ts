import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // USDC
  if ((await getOrNull('USDC')) == null) {
    await deploy('TestnetUSDC', {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }

  const USDCAddress = ((await getOrNull('USDC')) || (await get('TestnetUSDC'))).address

  // DSU and ancillary contracts
  if ((await getOrNull('DSU')) == null) {
    await deploy('TestnetDSU', {
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })

    await deploy('TestnetReserve', {
      args: [(await get('TestnetDSU')).address, USDCAddress],
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })

    await deploy('TestnetBatcher', {
      args: [(await get('TestnetReserve')).address],
      from: deployer,
      skipIfAlreadyDeployed: true,
      log: true,
      autoMine: true,
    })
  }
}

export default func
func.tags = ['Testnet']

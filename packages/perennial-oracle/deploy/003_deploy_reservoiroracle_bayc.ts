import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import '@nomiclabs/hardhat-ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  const reservoirBAYCDataFeedAddress = (await getOrNull('ReservoirDataFeedBAYCUSDC'))?.address

  if (reservoirBAYCDataFeedAddress === null) {
    console.log('no deployment found for ReservoirDataFeedBAYCUSDC')
    return
  }

  console.log('using ReservoirDataFeedBAYCUSDC address: ' + reservoirBAYCDataFeedAddress)

  // ORACLE

  await deploy('ReservoirFeedOracle_BAYC', {
    contract: 'ReservoirFeedOracle',
    args: [reservoirBAYCDataFeedAddress, 0],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
}

export default func
func.tags = ['ReservoirOracle_BAYC']

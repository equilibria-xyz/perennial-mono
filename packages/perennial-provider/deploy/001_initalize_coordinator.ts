import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { IController, IController__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const EXAMPLE_COORDINATOR_ID = 1

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Load

  const controller: IController = IController__factory.connect((await get('Controller_Proxy')).address, deployerSigner)
  const nextControllerId = await controller.callStatic.createCoordinator(deployerSigner.address)

  // Checks

  if (deployerSigner.address !== (await controller['owner()']())) {
    process.stdout.write('not deploying from protocol owner address... exiting.')
    return
  }

  // Run

  if (nextControllerId.eq(EXAMPLE_COORDINATOR_ID)) {
    process.stdout.write('creating example coordinator... ')
    await (await controller.createCoordinator(deployerSigner.address)).wait(2)
    process.stdout.write('complete.\n')
  } else {
    console.log('example controller already created.')
  }
}

export default func
func.tags = ['Coordinator']

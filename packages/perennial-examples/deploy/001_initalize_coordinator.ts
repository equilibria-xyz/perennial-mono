import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { IController, IController__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const EXAMPLE_COORDINATOR_ID = 1

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const coordinatorID = process.env.COORDINATOR_ID ? parseInt(process.env.COORDINATOR_ID) : EXAMPLE_COORDINATOR_ID
  const { deployments, getNamedAccounts, ethers } = hre
  const { get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Load
  const controller: IController = IController__factory.connect((await get('Controller_Proxy')).address, deployerSigner)
  const nextControllerId = await controller.callStatic.createCoordinator()

  // Run
  if (nextControllerId.eq(coordinatorID)) {
    process.stdout.write('creating example coordinator... ')
    await (await controller.createCoordinator()).wait(2)
    process.stdout.write('complete.\n')
  } else {
    console.log(`coordinator with id ${coordinatorID} already created.`)
  }
}

export default func
func.tags = ['Coordinator']

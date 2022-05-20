import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { getMultisigAddress } from '../test/testutil/constants'
import { IController, IController__factory, ProxyAdmin, ProxyAdmin__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const EXAMPLE_COORDINATOR_ID = 1

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Load

  const networkName = getNetworkName()
  const multisigAddress = getMultisigAddress(networkName) || deployer
  const controller: IController = IController__factory.connect((await get('Controller_Proxy')).address, deployerSigner)
  const proxyAdmin: ProxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  console.log('using multisig address: ' + multisigAddress)

  // Checks

  if ((await getOrNull('Product_Squeeth')) == null || (await getOrNull('Product_ShortEther')) == null) {
    process.stdout.write("products haven't been fully set up... exiting.")
    return
  }

  // Run

  const coordinator = await controller.coordinators(EXAMPLE_COORDINATOR_ID)
  if (coordinator.owner !== deployerSigner.address) {
    console.log(`not deploying from coordinator owner address... skipping.`)
  } else if (coordinator.pendingOwner === multisigAddress) {
    console.log(`coordinator pending owner already set to multisig address... skipping.`)
  } else {
    process.stdout.write(`transferring example coordinator pending owner to ${multisigAddress}... `)
    await (await controller.updateCoordinatorPendingOwner(EXAMPLE_COORDINATOR_ID, multisigAddress)).wait(2)
    process.stdout.write('complete.\n')
  }

  if ((await proxyAdmin.owner()) === multisigAddress) {
    console.log(`proxy admin owner already set to multisig address... skipping.`)
  } else {
    process.stdout.write(`transferring proxy admin owner to ${multisigAddress}... `)
    await (await proxyAdmin.transferOwnership(multisigAddress)).wait(2)
    process.stdout.write('complete.\n')
  }
}

export default func
func.tags = ['Examples']

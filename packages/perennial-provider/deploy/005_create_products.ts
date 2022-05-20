import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { IController, IController__factory, IProduct__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Address } from 'hardhat-deploy/dist/types'

const EXAMPLE_COORDINATOR_ID = 1

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Load

  const controller: IController = IController__factory.connect((await get('Controller_Proxy')).address, deployerSigner)

  // Checks

  if (deployerSigner.address !== (await controller['owner(uint256)'](EXAMPLE_COORDINATOR_ID))) {
    process.stdout.write('not deploying from coordinator owner address... exiting.')
    return
  }

  // Run

  await createOrReuseProduct(hre, deployerSigner, controller, 'Squeeth')
  await createOrReuseProduct(hre, deployerSigner, controller, 'ShortEther')
}

async function createOrReuseProduct(
  hre: HardhatRuntimeEnvironment,
  deployerSigner: SignerWithAddress,
  controller: IController,
  providerName: string,
) {
  const { get, getOrNull, save } = hre.deployments

  let productAddress: string | undefined = (await getOrNull(`Product_${providerName}`))?.address
  if (productAddress == null) {
    process.stdout.write(`creating product "${providerName}"... `)

    productAddress = await controller.callStatic.createProduct(
      EXAMPLE_COORDINATOR_ID,
      (
        await get(providerName)
      ).address,
    )
    await (await controller.createProduct(EXAMPLE_COORDINATOR_ID, (await get(providerName)).address)).wait(2)
    save(`Product_${providerName}`, { abi: IProduct__factory.abi, address: productAddress as Address })

    process.stdout.write(`deployed at ${productAddress}\n`)
  } else {
    console.log(`reusing product "${providerName}" at ${productAddress}`)
  }
}

export default func
func.tags = ['Examples']

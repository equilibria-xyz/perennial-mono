import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { IController, IController__factory, IProduct__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { address as baycOracleAddress } from '@equilibria/perennial/deployments/kovan/ReservoirFeedOracle_BAYC.json'

const EXAMPLE_COORDINATOR_ID = 1

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, save } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Load

  const controller: IController = IController__factory.connect((await get('Controller_Proxy')).address, deployerSigner)

  // Checks

  if (deployerSigner.address !== (await controller['owner(uint256)'](EXAMPLE_COORDINATOR_ID))) {
    process.stdout.write('not deploying from coordinator owner address... exiting.')
    return
  }

  // Setup

  const provider = await deploy('FloorBAYC', {
    args: [
      baycOracleAddress,
      ethers.utils.parseEther('0.30'),
      ethers.utils.parseEther('0.10'),
      0,
      0,
      ethers.utils.parseEther('2500'),
      {
        minRate: ethers.utils.parseEther('0.04'),
        maxRate: ethers.utils.parseEther('16.25'),
        targetRate: ethers.utils.parseEther('1.56'),
        targetUtilization: ethers.utils.parseEther('0.80'),
      },
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  let productAddress: string | undefined = (await getOrNull(`Product_FloorBAYC`))?.address
  if (productAddress == null) {
    process.stdout.write(`creating product "FloorBAYC"... `)

    productAddress = await controller.callStatic.createProduct(EXAMPLE_COORDINATOR_ID, provider.address)
    await (await controller.createProduct(EXAMPLE_COORDINATOR_ID, provider.address)).wait(2)
    save(`Product_FloorBAYC`, { abi: IProduct__factory.abi, address: productAddress })

    process.stdout.write(`deployed at ${productAddress}\n`)
  } else {
    console.log(`reusing product "FloorBAYC" at ${productAddress}`)
  }
}

export default func
func.tags = ['FloorBAYC']

import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import {
  IController,
  IController__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  ShortEther__factory,
} from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const EXAMPLE_COORDINATOR_ID = 1

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // Load

  const proxyAdmin: ProxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)
  const controller: IController = IController__factory.connect((await get('Controller_Proxy')).address, deployerSigner)

  // Checks

  if (deployerSigner.address !== (await controller['owner(uint256)'](EXAMPLE_COORDINATOR_ID))) {
    process.stdout.write('not deploying from coordinator owner address... exiting.')
    return
  }

  // Setup

  const providerImpl = await deploy('ShortEther', {
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const initData = ShortEther__factory.createInterface().encodeFunctionData('initialize', [
    (await get('ChainlinkOracle_ETH')).address,
    ethers.utils.parseEther('0.30'),
    ethers.utils.parseEther('0.10'),
    0,
    0,
    ethers.utils.parseEther('2500'),
    {
      minRate: ethers.utils.parseEther('-1.50'),
      maxRate: ethers.utils.parseEther('1.50'),
      targetRate: ethers.utils.parseEther('-0.25'),
      targetUtilization: ethers.utils.parseEther('0.80'),
    },
  ])

  await deploy(`ShortEther_Proxy`, {
    contract: 'TransparentUpgradeableProxy',
    args: [providerImpl.address, proxyAdmin.address, initData],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
}

export default func
func.tags = ['ShortEther']

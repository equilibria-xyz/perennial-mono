import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Deployment } from 'hardhat-deploy/dist/types'
import { getMultisigAddress } from '../../common/testutil/constants'
import {
  Collateral,
  Collateral__factory,
  Controller,
  Controller__factory,
  Incentivizer,
  Incentivizer__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const TIMELOCK_MIN_DELAY = 2 * 24 * 60 * 60
const ROOT_CONTROLLER_ID = 0

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  const networkName = getNetworkName()
  const dsuAddress = (await getOrNull('DSU'))?.address || (await get('TestnetDSU')).address
  const multisigAddress = getMultisigAddress(networkName) || deployer
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  console.log('using DSU address: ' + dsuAddress)
  console.log('using Multisig address: ' + multisigAddress)

  // IMPLEMENTATIONS

  const collateralImpl: Deployment = await deploy('Collateral_Impl', {
    contract: 'Collateral',
    args: [dsuAddress],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const productImpl: Deployment = await deploy('Product_Impl', {
    contract: 'Product',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const incentivizerImpl: Deployment = await deploy('Incentivizer_Impl', {
    contract: 'Incentivizer',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const controllerImpl: Deployment = await deploy('Controller_Impl', {
    contract: 'Controller',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // TIMELOCK

  const timelockController: Deployment = await deploy('TimelockController', {
    from: deployer,
    args: [TIMELOCK_MIN_DELAY, [multisigAddress], [ethers.constants.AddressZero]],
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // PROXY OWNERS

  await deploy('ProxyAdmin', {
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const productBeacon: Deployment = await deploy('UpgradeableBeacon', {
    from: deployer,
    args: [productImpl.address],
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const proxyAdmin: ProxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // PROXIES

  await deploy('Collateral_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [collateralImpl.address, proxyAdmin.address, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  await deploy('Incentivizer_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [incentivizerImpl.address, proxyAdmin.address, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  await deploy('Controller_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [controllerImpl.address, proxyAdmin.address, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // INITIALIZE

  const controller: Controller = new Controller__factory(deployerSigner).attach((await get('Controller_Proxy')).address)
  const collateral: Collateral = new Collateral__factory(deployerSigner).attach((await get('Collateral_Proxy')).address)
  const incentivizer: Incentivizer = new Incentivizer__factory(deployerSigner).attach(
    (await get('Incentivizer_Proxy')).address,
  )

  if ((await collateral.controller()) === controller.address) {
    console.log('Collateral already initialized.')
  } else {
    process.stdout.write('initializing Collateral... ')
    await (await collateral.initialize(controller.address)).wait(2)
    process.stdout.write('complete.\n')
  }

  if ((await incentivizer.controller()) === controller.address) {
    console.log('Incentivizer already initialized.')
  } else {
    process.stdout.write('initializing Incentivizer... ')
    await (await incentivizer.initialize(controller.address)).wait(2)
    process.stdout.write('complete.\n')
  }

  if ((await controller.productBeacon()) === productBeacon.address) {
    console.log('Controller already initialized.')
  } else {
    process.stdout.write('initializing Controller... ')
    await (await controller.initialize(collateral.address, incentivizer.address, productBeacon.address)).wait(2)
    process.stdout.write('complete.\n')
  }

  // TRANSFER OWNERSHIP

  if ((await proxyAdmin.owner()) === timelockController.address) {
    console.log(`proxyAdmin owner already set to ${timelockController.address}`)
  } else {
    process.stdout.write(`transferring proxyAdmin owner to ${timelockController.address}... `)
    await (await proxyAdmin.transferOwnership(timelockController.address)).wait(2)
    process.stdout.write('complete.\n')
  }

  if ((await controller.coordinators(ROOT_CONTROLLER_ID)).pendingOwner === timelockController.address) {
    console.log(`root controller pending owner already set to ${timelockController.address}`)
  } else {
    process.stdout.write(`transferring root controller pending owner to ${timelockController.address}... `)
    await (await controller.updateCoordinatorPendingOwner(ROOT_CONTROLLER_ID, timelockController.address)).wait(2)
    process.stdout.write('complete.\n')
  }
}

export default func
func.tags = ['Core']

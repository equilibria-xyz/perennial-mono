import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Deployment } from 'hardhat-deploy/dist/types'
import { getMultisigAddress } from '../../common/testutil/constants'
import {
  Controller__factory,
  IERC20__factory,
  MultiInvokerRollup__factory,
  MultiInvoker__factory,
} from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { isRollup } from '../../common/testutil/network'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull, getNetworkName } = deployments
  const { deployer } = await getNamedAccounts()

  // NETWORK CONSTANTS

  const networkName = getNetworkName()
  const dsuAddress = (await getOrNull('DSU'))?.address || (await get('TestnetDSU')).address
  const usdcAddress = (await getOrNull('USDC'))?.address || (await get('TestnetUSDC')).address
  const batcherAddress =
    (await getOrNull('Batcher'))?.address ||
    (await getOrNull('TestnetBatcher'))?.address ||
    ethers.constants.AddressZero
  const reserveAddress = (await getOrNull('EmptysetReserve'))?.address || (await get('TestnetReserve')).address
  const controllerAddress = (await get('Controller_Proxy')).address
  const proxyAdminAddress = (await get('ProxyAdmin')).address
  const multisigAddress = getMultisigAddress(networkName) || deployer
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  console.log('using DSU address: ' + dsuAddress)
  console.log('using USDC address: ' + usdcAddress)
  console.log('using Batcher address: ' + batcherAddress)
  console.log('using Controller address: ' + controllerAddress)
  console.log('using ProxyAdmin address: ' + proxyAdminAddress)
  console.log('using Multisig address: ' + multisigAddress)

  const usdc = await IERC20__factory.connect(usdcAddress, deployerSigner)

  const rollup = isRollup(networkName)
  const contractName = rollup ? 'MultiInvokerRollup' : 'MultiInvoker'

  const multiInvokerImpl: Deployment = await deploy('MultiInvoker_Impl', {
    contract: contractName,
    args: [usdcAddress, batcherAddress, reserveAddress, controllerAddress],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  await deploy('MultiInvoker_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [multiInvokerImpl.address, proxyAdminAddress, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // INITIALIZE
  let multiInvoker: any
  if (!rollup) {
    multiInvoker = await new MultiInvoker__factory(deployerSigner).attach((await get('MultiInvoker_Proxy')).address)
  } else {
    multiInvoker = await new MultiInvokerRollup__factory(deployerSigner).attach(
      (
        await get('MultiInvoker_Proxy')
      ).address,
    )
  }

  if ((await usdc.callStatic.allowance(multiInvoker.address, reserveAddress)).eq(ethers.constants.MaxUint256)) {
    console.log('MultiInvoker already initialized.')
  } else {
    process.stdout.write('initializing MultiInvoker... ')
    await (await multiInvoker.initialize()).wait(2)
    process.stdout.write('complete.\n')
  }

  const controller = await new Controller__factory(deployerSigner).attach(controllerAddress)

  // Set MultiInvoker on Controller
  if ((await controller.multiInvoker()) === multiInvoker.address) {
    console.log('MultiInvoker already set on Controller.')
  } else {
    process.stdout.write('Setting MultiInvoker address on Controller... ')
    await (await controller.updateMultiInvoker(multiInvoker.address)).wait(2)
    process.stdout.write('complete.\n')
  }
}

export default func
func.tags = ['MultiInvoker']

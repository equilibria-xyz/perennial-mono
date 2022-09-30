import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { TestnetDSU__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

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
      args: [deployer],
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

    // Update DSU to let the reserve mint
    const DSU = new TestnetDSU__factory(deployerSigner).attach((await get('TestnetDSU')).address)
    const reserveAddress = (await get('TestnetReserve')).address
    if ((await DSU.minter()).toLowerCase() !== reserveAddress) {
      process.stdout.write('Setting minter to reserve...')
      await (await DSU.updateMinter(reserveAddress)).wait(2)
      process.stdout.write('complete\n')
    }
  }
}

export default func
func.tags = ['Testnet']

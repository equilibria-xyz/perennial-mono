import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Collateral, Collateral__factory } from '../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // NETWORK CONSTANTS
  const dsuAddress = (await getOrNull('DSU'))?.address || (await get('TestnetDSU')).address
  const usdcAddress = (await getOrNull('USDC'))?.address || (await get('TestnetUSDC')).address
  const batcherAddress = (await getOrNull('Batcher'))?.address || (await getOrNull('TestnetBatcher'))?.address
  if (!batcherAddress) {
    console.log('Batcher not found. Skipping Forwarder deploy')
    return
  }

  const collateral: Collateral = new Collateral__factory(deployerSigner).attach((await get('Collateral_Proxy')).address)

  console.log('using DSU address: ' + dsuAddress)
  console.log('using USDC address: ' + usdcAddress)
  console.log('using batcher address: ' + batcherAddress)
  console.log('using collateral at ' + collateral.address)

  // FORWARDER
  await deploy('Forwarder', {
    contract: 'Forwarder',
    args: [usdcAddress, dsuAddress, batcherAddress, collateral.address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
}

export default func
func.tags = ['Forwarder']

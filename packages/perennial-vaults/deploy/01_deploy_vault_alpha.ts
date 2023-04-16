import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BalancedVault__factory } from '../types/generated'

const VAULT_TOKEN_NAME = 'Perennial Vault Alpha'
const VAULT_TOKEN_SYMBOL = 'PVA'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // TODO: network dependent
  const proxyAdminAddress = (await get('ProxyAdmin')).address
  const dsu = (await get('DSU')).address
  const controller = (await get('Controller_Proxy')).address
  const long = (await get('Product_LongEther')).address
  const short = (await get('Product_ShortEther')).address
  const targetLeverage = ethers.utils.parseEther('2')
  const maxCollateral = ethers.utils.parseEther('4000000')

  const vaultImpl = await deploy('PerennialVaultAlpha_Impl', {
    contract: 'BalancedVault',
    args: [dsu, controller, long, short, targetLeverage, maxCollateral],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  await deploy('PerennialVaultAlpha_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [vaultImpl.address, proxyAdminAddress, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Initialize
  const vault = new BalancedVault__factory(deployerSigner).attach((await get('PerennialVaultAlpha_Proxy')).address)
  if ((await vault.name()) === VAULT_TOKEN_NAME) {
    console.log('PerennialVaultAlpha already initialized.')
  } else {
    process.stdout.write('initializing PerennialVaultAlpha...')
    await (await vault.initialize(VAULT_TOKEN_NAME, VAULT_TOKEN_SYMBOL)).wait(2)
    process.stdout.write('complete.\n')
  }
}

export default func
func.tags = ['PerennialVaultAlpha']

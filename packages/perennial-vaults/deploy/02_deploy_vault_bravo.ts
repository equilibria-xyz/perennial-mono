import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BalancedVault__factory } from '../types/generated'

const VAULT_TOKEN_NAME = 'Perennial Vault Bravo'
const VAULT_TOKEN_SYMBOL = 'PVB'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // TODO: network dependent
  const proxyAdminAddress = (await get('ProxyAdmin')).address
  const dsu = (await get('DSU')).address
  const controller = (await get('Controller_Proxy')).address
  const long = (await get('Product_LongArbitrum')).address
  const short = (await get('Product_ShortArbitrum')).address
  const targetLeverage = ethers.utils.parseEther('2')
  const maxCollateral = ethers.utils.parseEther('500000')

  const vaultImpl = await deploy('PerennialVaultBravo_Impl', {
    contract: 'BalancedVault',
    args: [dsu, controller, long, short, targetLeverage, maxCollateral],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  await deploy('PerennialVaultBravo_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [vaultImpl.address, proxyAdminAddress, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Initialize
  const vault = new BalancedVault__factory(deployerSigner).attach((await get('PerennialVaultBravo_Proxy')).address)
  if ((await vault.name()) === VAULT_TOKEN_NAME) {
    console.log('PerennialVaultBravo already initialized.')
  } else {
    process.stdout.write('initializing PerennialVaultBravo...')
    await (await vault.initialize(VAULT_TOKEN_NAME, VAULT_TOKEN_SYMBOL)).wait(2)
    process.stdout.write('complete.\n')
  }
}

export default func
func.tags = ['PerennialVaultBravo']

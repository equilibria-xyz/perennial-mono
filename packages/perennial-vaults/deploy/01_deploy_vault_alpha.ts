import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { SingleBalancedVault__factory, IERC20__factory } from '../types/generated'
import { utils } from 'ethers'

const VAULT_TOKEN_NAME = 'Perennial Vault Alpha'
const VAULT_TOKEN_SYMBOL = 'PVA'
const SHARE_INFLATION_PREVENTION_DEPOSIT_AMOUNT = utils.parseEther('1')

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  // TODO: network dependent
  const proxyAdminAddress = (await get('ProxyAdmin')).address
  const dsu = (await get('DSU')).address
  const controller = (await get('Controller_Proxy')).address
  const long = (await get('Product_LongEther')).address
  const short = (await get('Product_ShortEther')).address
  const targetLeverage = ethers.utils.parseEther('1.5')
  const maxCollateral = ethers.utils.parseEther('6000000')
  const dsuERC20 = IERC20__factory.connect(dsu, deployerSigner)

  const vaultImpl = await deploy('PerennialVaultAlpha_Impl', {
    contract: 'BalancedVault',
    args: [dsu, controller, long, short, targetLeverage, maxCollateral],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // If no deployment detected
  const newProxyDeployment = (await getOrNull('PerennialVaultAlpha_Proxy')) === null
  if (newProxyDeployment) {
    if ((await dsuERC20.balanceOf(deployer)).lt(SHARE_INFLATION_PREVENTION_DEPOSIT_AMOUNT))
      throw new Error(
        `Insufficient DSU balance to prevent inflation attack. Please deposit at least ${utils.formatEther(
          SHARE_INFLATION_PREVENTION_DEPOSIT_AMOUNT,
        )} DSU to your deployer account.`,
      )
  }

  await deploy('PerennialVaultAlpha_Proxy', {
    contract: 'TransparentUpgradeableProxy',
    args: [vaultImpl.address, proxyAdminAddress, '0x'],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Initialize
  const vault = new SingleBalancedVault__factory(deployerSigner).attach(
    (await get('PerennialVaultAlpha_Proxy')).address,
  )
  if ((await vault.name()) === VAULT_TOKEN_NAME) {
    console.log('PerennialVaultAlpha already initialized.')
  } else {
    process.stdout.write('initializing PerennialVaultAlpha...')
    await (await vault.initialize(VAULT_TOKEN_NAME, VAULT_TOKEN_SYMBOL)).wait(2)
    process.stdout.write('complete.\n')
  }

  if (newProxyDeployment) {
    process.stdout.write('checking if inflation attack has occurred...')
    const currentDSUBalance = dsuERC20.balanceOf(vault.address)
    if ((await currentDSUBalance).gt(0)) throw new Error('WARNING: Share inflation attack detected!')
    process.stdout.write('complete.\n')

    process.stdout.write('depositing DSU to prevent inflation attack...')
    await vault.deposit(SHARE_INFLATION_PREVENTION_DEPOSIT_AMOUNT, deployer)
    process.stdout.write('checking if inflation attack has occurred...')
  }
}

export default func
func.tags = ['PerennialVaultAlpha']

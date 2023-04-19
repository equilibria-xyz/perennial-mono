import { expect } from 'chai'
import HRE from 'hardhat'
import { utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  BalancedVault,
  BalancedVault__factory,
  IController,
  IController__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../../../types/generated'
import { impersonate, time } from '../../../../../common/testutil'
import { expectVaultDeposit, expectVaultRedeemAndClaim } from '../../shared/actions.shared'

const { ethers, config } = HRE

describe('Vault - Perennial Vault Alpha - Arbitrum Verification', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let controller: IController
  let proxyAdmin: ProxyAdmin
  let vault: BalancedVault

  beforeEach(async () => {
    await time.reset(config)

    deployments = await HRE.deployments.all()
    ;[signer] = await ethers.getSigners()

    controller = IController__factory.connect(deployments['Controller_Proxy'].address, signer)
    proxyAdmin = ProxyAdmin__factory.connect(deployments['ProxyAdmin'].address, signer)
    vault = BalancedVault__factory.connect(deployments['PerennialVaultAlpha_Proxy'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(vault.callStatic.initialize('PerennialVaultAlpha')).to.be.revertedWithCustomError(
      vault,
      'UInitializableAlreadyInitializedError',
    )
  })

  it('has the correct parameters and configuration', async () => {
    expect(await vault.controller()).to.equal(controller.address)
    expect(await vault.collateral()).to.equal(await controller.collateral())

    expect(await vault.name()).to.equal('Perennial Vault Alpha')
    expect(await vault.maxCollateral()).to.equal(utils.parseEther('1000000'))
    expect(await vault.targetLeverage()).to.equal(utils.parseEther('3'))
    expect(await vault.asset()).to.equal(deployments['DSU'].address)

    expect(await proxyAdmin.getProxyAdmin(vault.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.getProxyImplementation(vault.address)).to.equal(
      deployments['PerennialVaultAlpha_Impl'].address,
    )
  })
})

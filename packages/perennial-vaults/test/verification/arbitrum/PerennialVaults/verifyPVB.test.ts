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

const { ethers } = HRE

describe('Vault - Perennial Vault Bravo - Arbitrum Verification', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let controller: IController
  let proxyAdmin: ProxyAdmin
  let vault: BalancedVault

  beforeEach(async () => {
    ;[signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = IController__factory.connect(deployments['Controller_Proxy'].address, signer)
    proxyAdmin = ProxyAdmin__factory.connect(deployments['ProxyAdmin'].address, signer)
    vault = BalancedVault__factory.connect(deployments['PerennialVaultBravo_Proxy'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(vault.callStatic.initialize('PerennialVaultBravo')).to.be.revertedWithCustomError(
      vault,
      'UInitializableAlreadyInitializedError',
    )
  })

  it('has the correct parameters and configuration', async () => {
    expect(await vault.controller()).to.equal(controller.address)
    expect(await vault.collateral()).to.equal(await controller.collateral())

    expect(await vault.name()).to.equal('Perennial Vault Bravo')
    expect(await vault.maxCollateral()).to.equal(utils.parseEther('500000'))
    expect(await vault.targetLeverage()).to.equal(utils.parseEther('2'))
    expect(await vault.asset()).to.equal(deployments['DSU'].address)

    expect(await proxyAdmin.getProxyAdmin(vault.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.getProxyImplementation(vault.address)).to.equal(
      deployments['PerennialVaultBravo_Impl'].address,
    )
  })
})

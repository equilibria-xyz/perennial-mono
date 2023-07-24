import { expect } from 'chai'
import HRE from 'hardhat'
import { utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  BalancedVault,
  BalancedVault__factory,
  ICollateral__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../../../types/generated'
import { impersonate, time } from '../../../../../common/testutil'
import { expectVaultDeposit, expectVaultRedeemAndClaim } from '../../shared/actions.shared'

const { ethers, config } = HRE

describe('Vault - Perennial Vaults - Multi-Asset Upgrade', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let proxyAdmin: ProxyAdmin
  let adminOwner: SignerWithAddress
  let vault: BalancedVault
  let vaultDepositor: SignerWithAddress

  beforeEach(async () => {
    await time.reset(config)

    deployments = await HRE.deployments.all()
    ;[signer] = await ethers.getSigners()

    proxyAdmin = ProxyAdmin__factory.connect(deployments['ProxyAdmin'].address, signer)
    adminOwner = await impersonate.impersonateWithBalance(await proxyAdmin.callStatic.owner(), utils.parseEther('1'))
    vault = BalancedVault__factory.connect(deployments['PerennialVaultAlpha_Proxy'].address, signer)
    vaultDepositor = await impersonate.impersonate('0xa045f488db8d754754fd89d0675725ef00e63264')
  })

  it('upgrades to the new multi-asset vault and keeps state', async () => {
    const prevVault = new ethers.Contract(vault.address, deployments['PerennialVaultAlpha_Impl'].abi, signer)
    const [long, short, totalSupply, totalAssets, totalUnclaimed, vaultBalances] = await Promise.all([
      prevVault.long(),
      prevVault.short(),
      prevVault.totalSupply(),
      prevVault.totalAssets(),
      prevVault.totalUnclaimed(),
      getVaultUsers(vault),
    ])

    const newImpl = await new BalancedVault__factory(signer).deploy(
      await vault.controller(),
      await vault.targetLeverage(),
      await vault.maxCollateral(),
      [{ long, short, weight: utils.parseEther('1') }],
      ethers.constants.AddressZero,
    )

    await proxyAdmin.connect(adminOwner).upgrade(vault.address, newImpl.address)
    await vault.initialize('PerennialVaultAlpha')

    expect(await proxyAdmin.callStatic.getProxyImplementation(vault.address)).to.equal(newImpl.address)
    expect((await vault.markets(0)).long).to.equal(long)
    expect((await vault.markets(0)).short).to.equal(short)
    expect(await vault.totalAssets()).to.equal(totalAssets)
    expect(await vault.totalUnclaimed()).to.equal(totalUnclaimed)
    expect(await vault.totalSupply()).to.equal(totalSupply)
    for (const { user, balance } of vaultBalances) {
      expect(await vault.balanceOf(user)).to.equal(balance)
    }
  })

  context('after upgraded', () => {
    beforeEach(async () => {
      const prevVault = new ethers.Contract(vault.address, deployments['PerennialVaultAlpha_Impl'].abi, signer)
      const [long, short] = await Promise.all([prevVault.long(), prevVault.short()])

      const newImpl = await new BalancedVault__factory(signer).deploy(
        await vault.controller(),
        await vault.targetLeverage(),
        await vault.maxCollateral(),
        [{ long, short, weight: utils.parseEther('1') }],
        ethers.constants.AddressZero,
      )
      await proxyAdmin.connect(adminOwner).upgrade(vault.address, newImpl.address)
    })

    it('deposits', async () => {
      await expectVaultDeposit(vault, signer, deployments, 'arbitrum', ['eth'])
    })

    it('redeems and claims', async () => {
      await expectVaultRedeemAndClaim(vault, signer, vaultDepositor, deployments, 'arbitrum', ['eth'])
    })

    it('updates to the new multi-asset vault with multiple markets', async () => {
      const arbLong = deployments['Product_LongArbitrum'].address
      const arbShort = deployments['Product_ShortArbitrum'].address
      const [market0, totalAssets, totalUnclaimed, totalSupply, vaultBalances] = await Promise.all([
        vault.markets(0),
        vault.totalAssets(),
        vault.totalUnclaimed(),
        vault.totalSupply(),
        getVaultUsers(vault),
      ])

      const newImplMulti = await new BalancedVault__factory(signer).deploy(
        await vault.controller(),
        await vault.targetLeverage(),
        await vault.maxCollateral(),
        [
          { long: market0.long, short: market0.short, weight: utils.parseEther('1') },
          { long: arbLong, short: arbShort, weight: utils.parseEther('0.1') },
        ],
        ethers.constants.AddressZero,
      )
      await proxyAdmin.connect(adminOwner).upgrade(vault.address, newImplMulti.address)
      await vault.initialize('PerennialVaultAlpha')
      expect(await proxyAdmin.callStatic.getProxyImplementation(vault.address)).to.equal(newImplMulti.address)

      expect((await vault.markets(0)).long).to.equal(market0.long)
      expect((await vault.markets(0)).short).to.equal(market0.short)
      expect((await vault.markets(1)).long).to.equal(arbLong)
      expect((await vault.markets(1)).short).to.equal(arbShort)

      expect(await vault.totalAssets()).to.equal(totalAssets)
      expect(await vault.totalUnclaimed()).to.equal(totalUnclaimed)
      expect(await vault.totalSupply()).to.equal(totalSupply)
      for (const { user, balance } of vaultBalances) {
        expect(await vault.balanceOf(user)).to.equal(balance)
      }
    })

    context('after multi-market upgrade', () => {
      beforeEach(async () => {
        const arbLong = deployments['Product_LongArbitrum'].address
        const arbShort = deployments['Product_ShortArbitrum'].address
        const market0 = await vault.markets(0)
        const newImplMulti = await new BalancedVault__factory(signer).deploy(
          await vault.controller(),
          await vault.targetLeverage(),
          await vault.maxCollateral(),
          [
            { long: market0.long, short: market0.short, weight: utils.parseEther('0.5') },
            { long: arbLong, short: arbShort, weight: utils.parseEther('0.5') },
          ],
          ethers.constants.AddressZero,
        )
        await proxyAdmin.connect(adminOwner).upgrade(vault.address, newImplMulti.address)
        await vault.initialize('PerennialVaultAlpha')
      })

      it('deposits', async () => {
        const collateral = ICollateral__factory.connect(deployments['Collateral_Proxy'].address, signer)
        const market1 = await vault.markets(1)
        const [longCollateral, shortCollateral] = await Promise.all([
          collateral['collateral(address,address)'](vault.address, market1.long),
          collateral['collateral(address,address)'](vault.address, market1.short),
        ])
        expect(longCollateral).to.equal(0)
        expect(shortCollateral).to.equal(0)

        await expectVaultDeposit(vault, signer, deployments, 'arbitrum', ['eth', 'arb'])

        expect(await collateral['collateral(address,address)'](vault.address, market1.long)).to.be.gt(0)
        expect(await collateral['collateral(address,address)'](vault.address, market1.short)).to.be.gt(0)
      })

      it('redeems and claims', async () => {
        await expectVaultRedeemAndClaim(vault, signer, vaultDepositor, deployments, 'arbitrum', ['eth', 'arb'])
      })
    })
  })
})

const getVaultUsers = async (vault: BalancedVault) => {
  const currentBlock = await ethers.provider.getBlockNumber()
  const vaultDeposits = await vault.queryFilter(vault.filters.Deposit(), currentBlock - 500000, currentBlock)
  const vaultUsers = Array.from(new Set(vaultDeposits.map(e => e.args.account)))
  const vaultBalances = await Promise.all(
    vaultUsers.map(async user => ({ user, balance: await vault.balanceOf(user) })),
  )

  return vaultBalances
}

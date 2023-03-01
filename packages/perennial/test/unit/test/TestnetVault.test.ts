import { smock, FakeContract } from '@defi-wonderland/smock'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { IERC20Metadata, TestnetVault, TestnetVault__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetVault', () => {
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let asset: FakeContract<IERC20Metadata>
  let testnetVault: TestnetVault

  beforeEach(async () => {
    ;[user, user2] = await ethers.getSigners()
    asset = await smock.fake<IERC20Metadata>('IERC20Metadata')
    asset.decimals.returns(18)
    testnetVault = await new TestnetVault__factory(user).deploy(asset.address)
  })

  describe('#name', async () => {
    it('returns correct name', async () => {
      expect(await testnetVault.name()).to.equal('TestnetVaultToken')
    })
  })

  describe('#symbol', async () => {
    it('returns correct symbol', async () => {
      expect(await testnetVault.symbol()).to.equal('TVT')
    })
  })

  describe('#decimals', async () => {
    it('returns the correct decimals', async () => {
      expect(await testnetVault.decimals()).to.equal(18)
    })
  })

  describe('#deposit', async () => {
    it('deposits into the vault', async () => {
      const amount = utils.parseEther('123')
      asset.transferFrom.whenCalledWith(user.address, testnetVault.address, amount).returns(true)

      await testnetVault.deposit(amount, user2.address)

      expect(await testnetVault.balanceOf(user2.address)).to.equal(amount)
    })
  })

  describe('#redeem', async () => {
    it('redeems from the vault', async () => {
      const amount = utils.parseEther('123')
      asset.transferFrom.whenCalledWith(user.address, testnetVault.address, amount).returns(true)
      await testnetVault.deposit(amount, user2.address)

      await testnetVault.connect(user2).redeem(amount, user2.address)

      expect(await testnetVault.balanceOf(user2.address)).to.equal(0)
      expect(await testnetVault.claimable(user2.address)).to.equal(amount)
    })
  })

  describe('#claim', async () => {
    it('claims the full amount from the vault', async () => {
      const amount = utils.parseEther('123')
      asset.transferFrom.whenCalledWith(user.address, testnetVault.address, amount).returns(true)
      await testnetVault.deposit(amount, user2.address)
      await testnetVault.connect(user2).redeem(amount, user2.address)

      asset.transfer.whenCalledWith(user2.address, amount).returns(true)

      expect(await testnetVault.claim(user2.address)).to.not.be.reverted

      expect(await testnetVault.balanceOf(user2.address)).to.equal(0)
      expect(await testnetVault.claimable(user2.address)).to.equal(0)
      expect(asset.transfer).to.have.been.calledWith(user2.address, amount)
    })
  })
})

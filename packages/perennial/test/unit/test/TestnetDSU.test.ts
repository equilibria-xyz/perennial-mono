import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetDSU, TestnetDSU__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetDSU', () => {
  let user: SignerWithAddress
  let minter: SignerWithAddress
  let testnetDSU: TestnetDSU

  beforeEach(async () => {
    ;[user, minter] = await ethers.getSigners()
    testnetDSU = await new TestnetDSU__factory(user).deploy(minter.address)
  })

  describe('#name', async () => {
    it('returns correct name', async () => {
      expect(await testnetDSU.name()).to.equal('Digital Standard Unit')
    })
  })

  describe('#symbol', async () => {
    it('returns correct symbol', async () => {
      expect(await testnetDSU.symbol()).to.equal('DSU')
    })
  })

  describe('#mint', async () => {
    it('mints tokens to the account', async () => {
      await testnetDSU.connect(minter).mint(user.address, utils.parseEther('123'))

      expect(await testnetDSU.balanceOf(user.address)).to.equal(utils.parseEther('123'))
    })

    it('reverts if minting over limit', async () => {
      await expect(
        testnetDSU.connect(minter).mint(user.address, utils.parseEther('1231231')),
      ).to.be.revertedWithCustomError(testnetDSU, 'TestnetDSUOverLimitError')
    })

    it('reverts if non-minter calls', async () => {
      await expect(testnetDSU.mint(user.address, utils.parseEther('1'))).to.be.revertedWithCustomError(
        testnetDSU,
        'TestnetDSUNotMinterError',
      )
    })
  })

  describe('#updateMinter', async () => {
    it('sets the new minter', async () => {
      await expect(testnetDSU.connect(minter).updateMinter(user.address))
        .to.emit(testnetDSU, 'TestnetDSUMinterUpdated')
        .withArgs(user.address)
    })

    it('reverts if not called by minter', async () => {
      await expect(testnetDSU.updateMinter(user.address)).to.be.revertedWithCustomError(
        testnetDSU,
        'TestnetDSUNotMinterError',
      )
    })
  })
})

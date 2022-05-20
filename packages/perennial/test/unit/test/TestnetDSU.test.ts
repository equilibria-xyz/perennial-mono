import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetDSU, TestnetDSU__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetDSU', () => {
  let user: SignerWithAddress
  let testnetDSU: TestnetDSU

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    testnetDSU = await new TestnetDSU__factory(user).deploy()
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
      await testnetDSU.mint(user.address, utils.parseEther('123'))

      expect(await testnetDSU.balanceOf(user.address)).to.equal(utils.parseEther('123'))
    })

    it('reverts if minting over limit', async () => {
      await expect(testnetDSU.mint(user.address, utils.parseEther('1231231'))).to.be.revertedWith(
        'TestnetDSUOverLimitError()',
      )
    })
  })
})

import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetUSDC, TestnetUSDC__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetUSDC', () => {
  let user: SignerWithAddress
  let testnetUSDC: TestnetUSDC

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    testnetUSDC = await new TestnetUSDC__factory(user).deploy()
  })

  describe('#name', async () => {
    it('returns correct name', async () => {
      expect(await testnetUSDC.name()).to.equal('USD Coin')
    })
  })

  describe('#symbol', async () => {
    it('returns correct symbol', async () => {
      expect(await testnetUSDC.symbol()).to.equal('USDC')
    })
  })

  describe('#decimals', async () => {
    it('returns the correct decimals', async () => {
      expect(await testnetUSDC.decimals()).to.equal(6)
    })
  })

  describe('#mint', async () => {
    it('mints tokens to the account', async () => {
      await testnetUSDC.mint(user.address, utils.parseEther('123'))

      expect(await testnetUSDC.balanceOf(user.address)).to.equal(utils.parseEther('123'))
    })
  })
})

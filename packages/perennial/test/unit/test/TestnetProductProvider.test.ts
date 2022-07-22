import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetPayoffProvider, TestnetPayoffProvider__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetPayoffProvider', () => {
  let user: SignerWithAddress
  let TestnetPayoffProvider: TestnetPayoffProvider

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    TestnetPayoffProvider = await new TestnetPayoffProvider__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await TestnetPayoffProvider.payoff(utils.parseEther('11'))).to.equal(utils.parseEther('121'))
    })
  })
})

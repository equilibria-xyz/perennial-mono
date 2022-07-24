import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { ShortEther, ShortEther__factory } from '../../../types/generated'

const { ethers } = HRE

describe('ShortEther', () => {
  let user: SignerWithAddress
  let shortEther: ShortEther

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    shortEther = await new ShortEther__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await shortEther.payoff(2)).to.equal(-2)
    })
  })
})

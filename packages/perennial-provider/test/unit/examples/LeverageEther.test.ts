import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { LeveragedEther, LeveragedEther__factory } from '../../../types/generated'

const { ethers } = HRE

describe('LeveragedEther', () => {
  let user: SignerWithAddress
  let leveragedEther: LeveragedEther

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    leveragedEther = await new LeveragedEther__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await leveragedEther.payoff(3)).to.equal(9)
    })
  })
})

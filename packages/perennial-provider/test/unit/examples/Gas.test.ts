import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { Gas, Gas__factory } from '../../../types/generated'

const { ethers } = HRE

describe('Gas', () => {
  let user: SignerWithAddress
  let gas: Gas

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    gas = await new Gas__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await gas.payoff(2)).to.equal(2)
    })
  })
})

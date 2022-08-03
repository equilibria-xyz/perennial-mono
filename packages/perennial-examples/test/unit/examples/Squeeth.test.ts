import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { Squeeth, Squeeth__factory } from '../../../types/generated'

const { ethers } = HRE

describe('Squeeth', () => {
  let user: SignerWithAddress
  let squeeth: Squeeth

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    squeeth = await new Squeeth__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await squeeth.payoff(utils.parseEther('11'))).to.equal(utils.parseEther('0.121'))
    })
  })
})

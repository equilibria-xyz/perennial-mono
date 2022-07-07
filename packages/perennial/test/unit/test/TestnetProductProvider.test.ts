import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetProductProvider, TestnetProductProvider__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetProductProvider', () => {
  let user: SignerWithAddress
  let testnetProductProvider: TestnetProductProvider

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    testnetProductProvider = await new TestnetProductProvider__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await testnetProductProvider.payoff(utils.parseEther('11'))).to.equal(utils.parseEther('121'))
    })
  })
})

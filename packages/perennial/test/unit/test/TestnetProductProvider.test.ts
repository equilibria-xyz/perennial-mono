import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetContractPayoffProvider, TestnetContractPayoffProvider__factory } from '../../../types/generated'

const { ethers } = HRE

describe('TestnetContractPayoffProvider', () => {
  let user: SignerWithAddress
  let TestnetContractPayoffProvider: TestnetContractPayoffProvider

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    TestnetContractPayoffProvider = await new TestnetContractPayoffProvider__factory(user).deploy()
  })

  describe('#payoff', async () => {
    it('modifies price per payoff', async () => {
      expect(await TestnetContractPayoffProvider.payoff(utils.parseEther('11'))).to.equal(utils.parseEther('121'))
    })
  })
})

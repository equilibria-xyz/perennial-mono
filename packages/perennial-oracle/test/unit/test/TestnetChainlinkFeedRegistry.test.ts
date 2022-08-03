import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { TestnetChainlinkFeedRegistry, TestnetChainlinkFeedRegistry__factory } from '../../../types/generated'

const { ethers } = HRE

describe('PassthroughChainlinkFeed', () => {
  let user: SignerWithAddress
  let eth: SignerWithAddress
  let usd: SignerWithAddress
  let testnetChainlinkFeed: TestnetChainlinkFeedRegistry

  beforeEach(async () => {
    ;[user, eth, usd] = await ethers.getSigners()
    testnetChainlinkFeed = await new TestnetChainlinkFeedRegistry__factory(user).deploy()
  })

  describe('#registerFeed', async () => {
    it('registers new feed', async () => {
      await testnetChainlinkFeed.registerFeed(eth.address, usd.address, 8)
      expect(await testnetChainlinkFeed.decimals(eth.address, usd.address)).to.equal(8)
    })
  })
})

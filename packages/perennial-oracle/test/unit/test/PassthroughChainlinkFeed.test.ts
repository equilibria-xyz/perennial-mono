import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  FeedRegistryInterface__factory,
  PassthroughChainlinkFeed,
  PassthroughChainlinkFeed__factory,
} from '../../../types/generated'
import { MockContract, deployMockContract } from '@ethereum-waffle/mock-contract'

const { ethers } = HRE

describe('PassthroughChainlinkFeed', () => {
  let user: SignerWithAddress
  let eth: SignerWithAddress
  let usd: SignerWithAddress
  let passthroughChainlinkFeed: PassthroughChainlinkFeed
  let feedRegistry: MockContract

  beforeEach(async () => {
    ;[user, eth, usd] = await ethers.getSigners()
    feedRegistry = await deployMockContract(user, FeedRegistryInterface__factory.abi)
    passthroughChainlinkFeed = await new PassthroughChainlinkFeed__factory(user).deploy(feedRegistry.address)
  })

  describe('#decimals', async () => {
    it('passes through call', async () => {
      await feedRegistry.mock.decimals.withArgs(eth.address, usd.address).returns(8)
      expect(await passthroughChainlinkFeed.decimals(eth.address, usd.address)).to.equal(8)
    })
  })

  describe('#getRoundData', async () => {
    it('passes through call', async () => {
      await feedRegistry.mock.getRoundData.withArgs(eth.address, usd.address, 123).returns(123, 1111, 13, 14, 123)
      const round = await passthroughChainlinkFeed.getRoundData(eth.address, usd.address, 123)
      expect(round[0]).to.equal(123)
      expect(round[1]).to.equal(1111)
      expect(round[2]).to.equal(13)
      expect(round[3]).to.equal(14)
      expect(round[4]).to.equal(123)
    })
  })

  describe('#latestRoundData', async () => {
    it('passes through call', async () => {
      await feedRegistry.mock.latestRoundData.withArgs(eth.address, usd.address).returns(123, 1111, 13, 14, 123)
      const round = await passthroughChainlinkFeed.latestRoundData(eth.address, usd.address)
      expect(round[0]).to.equal(123)
      expect(round[1]).to.equal(1111)
      expect(round[2]).to.equal(13)
      expect(round[3]).to.equal(14)
      expect(round[4]).to.equal(123)
    })
  })

  describe('#getPhaseRange', async () => {
    it('passes through call', async () => {
      await feedRegistry.mock.getPhaseRange.withArgs(eth.address, usd.address, 2).returns(123, 456)
      const range = await passthroughChainlinkFeed.getPhaseRange(eth.address, usd.address, 2)
      expect(range[0]).to.equal(123)
      expect(range[1]).to.equal(456)
    })
  })
})

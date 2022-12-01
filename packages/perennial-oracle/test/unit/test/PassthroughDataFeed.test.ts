import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  AggregatorV3Interface__factory,
  PassthroughDataFeed,
  PassthroughDataFeed__factory,
} from '../../../types/generated'
import { MockContract, deployMockContract } from '@ethereum-waffle/mock-contract'

const { ethers } = HRE

describe('PassthroughDataFeed', () => {
  let user: SignerWithAddress
  let PassthroughDataFeed: PassthroughDataFeed
  let feed: MockContract

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    feed = await deployMockContract(user, AggregatorV3Interface__factory.abi)
    PassthroughDataFeed = await new PassthroughDataFeed__factory(user).deploy(feed.address)
  })

  describe('#decimals', async () => {
    it('passes through call', async () => {
      await feed.mock.decimals.returns(8)
      expect(await PassthroughDataFeed.decimals()).to.equal(8)
    })
  })

  describe('#getRoundData', async () => {
    it('passes through call', async () => {
      await feed.mock.getRoundData.withArgs(123).returns(123, 1111, 13, 14, 123)
      const round = await PassthroughDataFeed.getRoundData(123)
      expect(round[0]).to.equal(123)
      expect(round[1]).to.equal(1111)
      expect(round[2]).to.equal(13)
      expect(round[3]).to.equal(14)
      expect(round[4]).to.equal(123)
    })
  })

  describe('#latestRoundData', async () => {
    it('passes through call', async () => {
      await feed.mock.latestRoundData.returns(123, 1111, 13, 14, 123)
      const round = await PassthroughDataFeed.latestRoundData()
      expect(round[0]).to.equal(123)
      expect(round[1]).to.equal(1111)
      expect(round[2]).to.equal(13)
      expect(round[3]).to.equal(14)
      expect(round[4]).to.equal(123)
    })
  })
})

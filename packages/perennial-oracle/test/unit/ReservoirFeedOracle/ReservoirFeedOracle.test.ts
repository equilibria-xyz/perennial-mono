import { smock, FakeContract } from '@defi-wonderland/smock'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  ReservoirFeedOracle,
  ReservoirFeedOracle__factory,
  AggregatorV3Interface,
  AggregatorV3Interface__factory,
} from '../../../types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'

const { ethers } = HRE

const HOUR = 60 * 60
use(smock.matchers)

describe('ReservoirFeedOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let feed: FakeContract<AggregatorV3Interface>

  let oracle: ReservoirFeedOracle

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()
    feed = await smock.fake<AggregatorV3Interface>(AggregatorV3Interface__factory.abi)
  })

  describe('#constructor', async () => {
    it('sets initial params', async () => {
      await feed.decimals.returns(8)

      oracle = await new ReservoirFeedOracle__factory(owner).deploy(feed.address, 0)

      expect(await oracle.feed()).to.equal(feed.address)
      expect(feed.decimals).to.have.been.called
    })
  })

  describe('#sync', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      await feed.decimals.returns(8)
      oracle = await new ReservoirFeedOracle__factory(owner).deploy(feed.address, 0)
    })

    it('syncs first version', async () => {
      const roundId = 23
      await feed.latestRoundData.returns([
        roundId,
        ethers.BigNumber.from(111100000000),
        TIMESTAMP_START - HOUR,
        TIMESTAMP_START,
        roundId,
      ])

      await feed.getRoundData.returns([
        roundId,
        ethers.BigNumber.from(111100000000),
        TIMESTAMP_START - HOUR,
        TIMESTAMP_START,
        roundId,
      ])

      const returnValue = await oracle.callStatic.sync()
      oracle.connect(user).sync()

      expect(returnValue.price).to.equal(utils.parseEther('1111'))
      expect(returnValue.timestamp).to.equal(TIMESTAMP_START)
      expect(returnValue.version).to.equal(23)

      const currentVersion = await oracle.currentVersion()
      expect(currentVersion.price).to.equal(utils.parseEther('1111'))
      expect(currentVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(currentVersion.version).to.equal(23)

      const atVersion = await oracle.atVersion(23)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(23)
    })

    describe('after synced', async () => {
      beforeEach(async () => {
        const roundId = 23

        await feed.latestRoundData.returns([
          roundId,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START,
          roundId,
        ])

        await oracle.connect(user).sync()
      })

      it('syncs new version if available', async () => {
        const roundId = 24
        await feed.latestRoundData.returns([
          roundId,
          ethers.BigNumber.from(122200000000),
          TIMESTAMP_START,
          TIMESTAMP_START + HOUR,
          roundId,
        ])

        await feed.getRoundData.returns([
          roundId,
          ethers.BigNumber.from(122200000000),
          TIMESTAMP_START,
          TIMESTAMP_START + HOUR,
          roundId,
        ])

        const returnValue = await oracle.callStatic.sync()
        oracle.connect(user).sync()

        expect(returnValue.price).to.equal(utils.parseEther('1222'))
        expect(returnValue.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(returnValue.version).to.equal(24)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(utils.parseEther('1222'))
        expect(currentVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(currentVersion.version).to.equal(24)

        const atVersion = await oracle.atVersion(24)
        expect(atVersion.price).to.equal(utils.parseEther('1222'))
        expect(atVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(atVersion.version).to.equal(24)
      })
    })
  })

  describe('#atVersion', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      await feed.decimals.returns(8)
      oracle = await new ReservoirFeedOracle__factory(owner).deploy(feed.address, 0)

      const roundId = 23

      await feed.latestRoundData.returns([
        roundId,
        ethers.BigNumber.from(111100000000),
        TIMESTAMP_START - HOUR,
        TIMESTAMP_START,
        roundId,
      ])

      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const roundId = 12

      await feed.getRoundData
        .whenCalledWith(roundId)
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

      const atVersion = await oracle.atVersion(12)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(12)
    })

    it('reverts if reading an invalid version', async () => {
      await expect(oracle.atVersion(utils.parseEther('10000000000000000'))).to.be.revertedWithCustomError(
        oracle,
        'InvalidOracleVersion',
      )
    })
  })
})

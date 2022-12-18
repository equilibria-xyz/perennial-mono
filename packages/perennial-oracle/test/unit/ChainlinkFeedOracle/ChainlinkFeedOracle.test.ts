import { MockContract } from '@ethereum-waffle/mock-contract'
import { smock, FakeContract } from '@defi-wonderland/smock'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  ChainlinkFeedOracle,
  ChainlinkFeedOracle__factory,
  AggregatorProxyInterface,
  AggregatorProxyInterface__factory,
  AggregatorV2V3Interface,
  AggregatorV2V3Interface__factory,
} from '../../../types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { buildChainlinkRoundId } from '../../../util'

const { ethers } = HRE

const HOUR = 60 * 60

describe('ChainlinkFeedOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let aggregatorProxy: FakeContract<AggregatorProxyInterface>
  let phase1Aggregator: FakeContract<AggregatorV2V3Interface>
  let phase2Aggregator: FakeContract<AggregatorV2V3Interface>

  let oracle: ChainlinkFeedOracle

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()
    aggregatorProxy = await smock.fake<AggregatorProxyInterface>(AggregatorProxyInterface__factory.abi)
    aggregatorProxy.phaseId.returns(1)

    phase1Aggregator = await smock.fake<AggregatorV2V3Interface>(AggregatorV2V3Interface__factory.abi)
    phase2Aggregator = await smock.fake<AggregatorV2V3Interface>(AggregatorV2V3Interface__factory.abi)

    aggregatorProxy.phaseAggregators.whenCalledWith(1).returns(phase1Aggregator.address)
    aggregatorProxy.phaseAggregators.whenCalledWith(2).returns(phase2Aggregator.address)
  })

  describe('#constructor', async () => {
    it('sets initial params', async () => {
      aggregatorProxy.decimals.whenCalledWith().returns(8)

      oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address)

      expect(await oracle.aggregator()).to.equal(aggregatorProxy.address)
    })
  })

  describe('#sync', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      aggregatorProxy.decimals.whenCalledWith().returns(8)
      oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address)
    })

    it('syncs first version', async () => {
      const roundId = buildChainlinkRoundId(1, 24)
      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

      aggregatorProxy.getRoundData
        .whenCalledWith(roundId)
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

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
        const roundId = buildChainlinkRoundId(1, 24)

        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

        await oracle.connect(user).sync()
      })

      it('doesnt sync new version if not available', async () => {
        const roundId = buildChainlinkRoundId(1, 24)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

        aggregatorProxy.getRoundData
          .whenCalledWith(roundId)
          .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

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

      it('syncs new version if available', async () => {
        const roundId = buildChainlinkRoundId(1, 25)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(122200000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        aggregatorProxy.getRoundData
          .whenCalledWith(roundId)
          .returns([roundId, ethers.BigNumber.from(122200000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

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

      it('syncs with new phase', async () => {
        phase1Aggregator.latestRoundData.returns([81, 0, 0, 0, 0])

        const roundId = buildChainlinkRoundId(2, 345)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        aggregatorProxy.getRoundData
          .whenCalledWith(roundId)
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(utils.parseEther('1333'))
        expect(returnValue.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(returnValue.version).to.equal(426)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(utils.parseEther('1333'))
        expect(currentVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(currentVersion.version).to.equal(426)

        const atVersion = await oracle.atVersion(426)
        expect(atVersion.price).to.equal(utils.parseEther('1333'))
        expect(atVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(atVersion.version).to.equal(426)
      })
    })
  })

  describe.only('#atVersion', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      aggregatorProxy.decimals.whenCalledWith().returns(8)
      phase1Aggregator.latestRoundData.returns([400, 0, 0, 0, 0])
      oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address)

      const roundId = buildChainlinkRoundId(1, 123)

      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const roundId = buildChainlinkRoundId(1, 13)

      aggregatorProxy.getRoundData
        .whenCalledWith(roundId)
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

      const atVersion = await oracle.atVersion(12)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(12)
    })

    it('reads versions in multiple phases', async () => {
      const currentRoundId = buildChainlinkRoundId(3, 350)

      phase2Aggregator.latestRoundData.returns([299, 0, 0, 0, 0])

      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([
          currentRoundId,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START,
          currentRoundId,
        ])

      // Syncs from Phase 1 to Phase 3
      await oracle.connect(user).sync()

      // Check Version from Phase 1: Versions 0 to 400
      const roundIdPhase1 = buildChainlinkRoundId(1, 13)
      aggregatorProxy.getRoundData
        .whenCalledWith(roundIdPhase1)
        .returns([
          roundIdPhase1,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - 6 * HOUR,
          TIMESTAMP_START - 5 * HOUR,
          roundIdPhase1,
        ])
      const atVersionPhase1 = await oracle.atVersion(12)
      expect(atVersionPhase1.price).to.equal(utils.parseEther('1111'))
      expect(atVersionPhase1.timestamp).to.equal(TIMESTAMP_START - 5 * HOUR)
      expect(atVersionPhase1.version).to.equal(12)

      // Check Version from Phase 2: Versions 401 to 700
      const roundIdPhase2 = buildChainlinkRoundId(2, 201)
      aggregatorProxy.getRoundData
        .whenCalledWith(roundIdPhase2)
        .returns([
          roundIdPhase2,
          ethers.BigNumber.from(123400000000),
          TIMESTAMP_START - 3 * HOUR,
          TIMESTAMP_START - 2 * HOUR,
          roundIdPhase2,
        ])
      const atVersion2 = await oracle.atVersion(601)
      expect(atVersion2.price).to.equal(utils.parseEther('1234'))
      expect(atVersion2.timestamp).to.equal(TIMESTAMP_START - 2 * HOUR)
      expect(atVersion2.version).to.equal(601)

      // Check Version from Phase 3: Versions 701 onwards
      const roundIdPhase3 = buildChainlinkRoundId(3, 1)
      aggregatorProxy.getRoundData
        .whenCalledWith(roundIdPhase3)
        .returns([
          roundIdPhase3,
          ethers.BigNumber.from(211100000000),
          TIMESTAMP_START - 2 * HOUR,
          TIMESTAMP_START - 1 * HOUR,
          roundIdPhase3,
        ])
      const atVersion3 = await oracle.atVersion(701)
      expect(atVersion3.price).to.equal(utils.parseEther('2111'))
      expect(atVersion3.timestamp).to.equal(TIMESTAMP_START - 1 * HOUR)
      expect(atVersion3.version).to.equal(701)
    })
  })
})

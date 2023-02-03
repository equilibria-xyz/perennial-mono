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
} from '../../../types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { buildChainlinkRoundId } from '../../../util'

const { ethers } = HRE

const HOUR = 60 * 60
const INITIAL_PHASE = 1
const INITIAL_ROUND = 12

describe('ChainlinkFeedOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let aggregatorProxy: FakeContract<AggregatorProxyInterface>

  let oracle: ChainlinkFeedOracle

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()
    aggregatorProxy = await smock.fake<AggregatorProxyInterface>(AggregatorProxyInterface__factory.abi)
    const initialRound = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND)
    aggregatorProxy.latestRoundData.returns([initialRound, ethers.BigNumber.from(432100000000), 0, HOUR, initialRound])

    aggregatorProxy.decimals.whenCalledWith().returns(8)
    oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address)
  })

  describe('#constructor', () => {
    it('sets initial params', async () => {
      expect(await oracle.aggregator()).to.equal(aggregatorProxy.address)
    })

    it('returns version 0', async () => {
      const initialRound = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND)
      aggregatorProxy.getRoundData
        .whenCalledWith(initialRound)
        .returns([initialRound, ethers.BigNumber.from(432100000000), 0, HOUR, initialRound])

      const atVersion = await oracle.atVersion(0)
      expect(atVersion.price).to.equal(utils.parseEther('4321'))
      expect(atVersion.timestamp).to.equal(HOUR)
      expect(atVersion.version).to.equal(0)
    })
  })

  describe('#sync', () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()
    })

    it('syncs first version', async () => {
      const roundId = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 23)
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
        const roundId = buildChainlinkRoundId(1, INITIAL_ROUND + 24)

        aggregatorProxy.getRoundData
          .whenCalledWith(roundId)
          .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

        await oracle.connect(user).sync()
      })

      it('doesnt sync new version if not available', async () => {
        const roundId = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 24)
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
        expect(returnValue.version).to.equal(24)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(utils.parseEther('1111'))
        expect(currentVersion.timestamp).to.equal(TIMESTAMP_START)
        expect(currentVersion.version).to.equal(24)

        const atVersion = await oracle.atVersion(24)
        expect(atVersion.price).to.equal(utils.parseEther('1111'))
        expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
        expect(atVersion.version).to.equal(24)
      })

      it('syncs new version if available', async () => {
        const roundId = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 25)
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
        expect(returnValue.version).to.equal(25)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(utils.parseEther('1222'))
        expect(currentVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(currentVersion.version).to.equal(25)

        const atVersion = await oracle.atVersion(25)
        expect(atVersion.price).to.equal(utils.parseEther('1222'))
        expect(atVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(atVersion.version).to.equal(25)
      })

      it('syncs with new phase', async () => {
        const phase1NextRound = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 25)
        aggregatorProxy.getRoundData
          .whenCalledWith(phase1NextRound)
          .returns([
            phase1NextRound,
            ethers.BigNumber.from(122200000000),
            TIMESTAMP_START - HOUR,
            TIMESTAMP_START - HOUR,
            phase1NextRound,
          ])

        // This is the first seen round of the new phase
        // Phase 1 was (37 - 12 + 1) = 26 rounds long (versions 0 to 25), so this is version 26
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 1, 345)
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
        expect(returnValue.version).to.equal(26)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(utils.parseEther('1333'))
        expect(currentVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(currentVersion.version).to.equal(26)

        const atVersion = await oracle.atVersion(26)
        expect(atVersion.price).to.equal(utils.parseEther('1333'))
        expect(atVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(atVersion.version).to.equal(26)
      })

      it('syncs with new phase with walkback', async () => {
        const phase1NextRound = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 25)
        aggregatorProxy.getRoundData.whenCalledWith(phase1NextRound).reverts()

        // This is the first seen round of the new phase
        // Phase 1 was (36 - 12 + 1) = 25 rounds long (versions 0 to 24)
        // Phase 2 starts at version 25 which is 2 rounds before this due to walkback, so this is version 27
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 1, 345)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        aggregatorProxy.getRoundData
          .whenCalledWith(roundId)
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        // Walk back in phase until crossover point
        aggregatorProxy.getRoundData
          .whenCalledWith(roundId.sub(1))
          .returns([
            roundId.sub(1),
            ethers.BigNumber.from(122200000000),
            TIMESTAMP_START + HOUR,
            TIMESTAMP_START + HOUR,
            roundId.sub(1),
          ])
        aggregatorProxy.getRoundData
          .whenCalledWith(roundId.sub(2))
          .returns([
            roundId.sub(1),
            ethers.BigNumber.from(122200000000),
            TIMESTAMP_START + HOUR,
            TIMESTAMP_START + HOUR,
            roundId.sub(1),
          ])
        aggregatorProxy.getRoundData
          .whenCalledWith(roundId.sub(3))
          .returns([
            roundId.sub(1),
            ethers.BigNumber.from(122200000000),
            TIMESTAMP_START - HOUR,
            TIMESTAMP_START - HOUR,
            roundId.sub(2),
          ])

        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(utils.parseEther('1333'))
        expect(returnValue.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(returnValue.version).to.equal(27)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(utils.parseEther('1333'))
        expect(currentVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(currentVersion.version).to.equal(27)

        const atVersion = await oracle.atVersion(27)
        expect(atVersion.price).to.equal(utils.parseEther('1333'))
        expect(atVersion.timestamp).to.equal(TIMESTAMP_START + HOUR)
        expect(atVersion.version).to.equal(27)
      })

      it('reverts if syncing multiple phases in a single sync call', async () => {
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 2, 345)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'UnableToSyncError')
      })

      it('reverts on invalid round', async () => {
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 1, 0)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'InvalidOracleRound')
      })
    })
  })

  describe('#atVersion', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      const roundId = buildChainlinkRoundId(INITIAL_PHASE, 90)
      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const roundId = buildChainlinkRoundId(1, INITIAL_ROUND + 1)

      aggregatorProxy.getRoundData
        .whenCalledWith(roundId)
        .returns([roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId])

      const atVersion = await oracle.atVersion(1)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(1)
    })

    it('reads versions in multiple phases', async () => {
      const currentRoundId = buildChainlinkRoundId(3, 350)

      // Phase1 goes from round 12 -> 91 (versions 0 to 79)
      const phase1LastRound = buildChainlinkRoundId(INITIAL_PHASE, 91)
      aggregatorProxy.getRoundData
        .whenCalledWith(phase1LastRound)
        .returns([
          phase1LastRound,
          ethers.BigNumber.from(122200000000),
          TIMESTAMP_START - 2 * HOUR,
          TIMESTAMP_START - 2 * HOUR,
          phase1LastRound,
        ])
      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([
          buildChainlinkRoundId(2, 356),
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START - HOUR,
          currentRoundId,
        ])
      // Syncs from Phase 1 to Phase 2
      await oracle.connect(user).sync()

      // Syncs from beginning of Phase 2 to middle
      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([
          buildChainlinkRoundId(2, 399),
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START - HOUR,
          buildChainlinkRoundId(2, 399),
        ])
      await oracle.connect(user).sync()

      // Phase2 goes from round 356 -> 400 (versions 80 to 124)
      const phase2LastRound = buildChainlinkRoundId(INITIAL_PHASE + 1, 400)
      aggregatorProxy.getRoundData
        .whenCalledWith(phase2LastRound)
        .returns([
          phase2LastRound,
          ethers.BigNumber.from(122200000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START - HOUR,
          phase2LastRound,
        ])
      aggregatorProxy.latestRoundData
        .whenCalledWith()
        .returns([
          buildChainlinkRoundId(3, 16),
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START,
          TIMESTAMP_START,
          currentRoundId,
        ])
      // Syncs from Phase 2 to Phase 3
      await oracle.connect(user).sync()

      // Check Version from Phase 1: Versions 0 to 79
      // Check last round of phase1
      const roundIdPhase1 = buildChainlinkRoundId(1, 91)
      aggregatorProxy.getRoundData
        .whenCalledWith(roundIdPhase1)
        .returns([
          roundIdPhase1,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - 6 * HOUR,
          TIMESTAMP_START - 5 * HOUR,
          roundIdPhase1,
        ])
      const atVersionPhase1 = await oracle.atVersion(79)
      expect(atVersionPhase1.price).to.equal(utils.parseEther('1111'))
      expect(atVersionPhase1.timestamp).to.equal(TIMESTAMP_START - 5 * HOUR)
      expect(atVersionPhase1.version).to.equal(79)

      // Check Version from Phase 2: Versions 80 to 124
      const roundIdPhase2 = buildChainlinkRoundId(2, 356)
      aggregatorProxy.getRoundData
        .whenCalledWith(roundIdPhase2)
        .returns([
          roundIdPhase2,
          ethers.BigNumber.from(123400000000),
          TIMESTAMP_START - 3 * HOUR,
          TIMESTAMP_START - 2 * HOUR,
          roundIdPhase2,
        ])
      // Check first round of phase2
      const atVersion2 = await oracle.atVersion(80)
      expect(atVersion2.price).to.equal(utils.parseEther('1234'))
      expect(atVersion2.timestamp).to.equal(TIMESTAMP_START - 2 * HOUR)
      expect(atVersion2.version).to.equal(80)

      // Check Version from Phase 3: Versions 125 onwards
      const roundIdPhase3 = buildChainlinkRoundId(3, 16)
      aggregatorProxy.getRoundData
        .whenCalledWith(roundIdPhase3)
        .returns([
          roundIdPhase3,
          ethers.BigNumber.from(211100000000),
          TIMESTAMP_START - 2 * HOUR,
          TIMESTAMP_START - 1 * HOUR,
          roundIdPhase3,
        ])
      // Check first round of phase 3
      const atVersion3 = await oracle.atVersion(125)
      expect(atVersion3.price).to.equal(utils.parseEther('2111'))
      expect(atVersion3.timestamp).to.equal(TIMESTAMP_START - 1 * HOUR)
      expect(atVersion3.version).to.equal(125)
    })
  })
})

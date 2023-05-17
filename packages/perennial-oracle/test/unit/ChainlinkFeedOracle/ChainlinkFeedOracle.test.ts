import { smock, FakeContract } from '@defi-wonderland/smock'
import { BigNumber, BigNumberish, utils } from 'ethers'
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
    oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, [])
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

    context('with phases passed in', () => {
      beforeEach(async () => {
        const latestRound = buildChainlinkRoundId(2, 400)
        aggregatorProxy.latestRoundData.returns([
          latestRound,
          ethers.BigNumber.from(123400000000),
          0,
          HOUR,
          latestRound,
        ])

        const initialPhases = [
          { startingVersion: 0, startingRoundId: 0 },
          { startingVersion: 0, startingRoundId: buildChainlinkRoundId(1, 5) },
          { startingVersion: 12, startingRoundId: buildChainlinkRoundId(2, 123) },
        ]
        oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, initialPhases)
      })

      it('sets initial params', async () => {
        expect(await oracle.aggregator()).to.equal(aggregatorProxy.address)
      })

      it('returns version 0', async () => {
        const version0Round = buildChainlinkRoundId(1, 5)
        aggregatorProxy.getRoundData
          .whenCalledWith(version0Round)
          .returns([version0Round, 432100000000, 0, HOUR, version0Round])

        const atVersion = await oracle.atVersion(0)
        expect(atVersion.price).to.equal(utils.parseEther('4321'))
        expect(atVersion.timestamp).to.equal(HOUR)
        expect(atVersion.version).to.equal(0)
      })

      it('returns a version from a passed in phase', async () => {
        // Round from Phase 2
        const version12Round = buildChainlinkRoundId(2, 123)
        aggregatorProxy.getRoundData
          .whenCalledWith(version12Round)
          .returns([version12Round, 123400000000, 0, HOUR * 2, version12Round])

        const atVersion = await oracle.atVersion(12)
        expect(atVersion.price).to.equal(utils.parseEther('1234'))
        expect(atVersion.timestamp).to.equal(HOUR * 2)
        expect(atVersion.version).to.equal(12)
      })

      it('reverts if phases array has less than 2 items', async () => {
        const initialPhases = [{ startingVersion: 0, startingRoundId: 0 }]
        await expect(
          new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, initialPhases),
        ).to.be.revertedWithCustomError(oracle, 'InvalidPhaseInitialization')
      })

      it('reverts if phases[0] is non-empty', async () => {
        const initialPhases = [
          { startingVersion: 1, startingRoundId: 0 },
          { startingVersion: 0, startingRoundId: 0 },
        ]
        await expect(
          new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, initialPhases),
        ).to.be.revertedWithCustomError(oracle, 'InvalidPhaseInitialization')
      })

      it('reverts if phases[1] does not start at version 0', async () => {
        const initialPhases = [
          { startingVersion: 0, startingRoundId: 0 },
          { startingVersion: 1, startingRoundId: 0 },
        ]
        await expect(
          new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, initialPhases),
        ).to.be.revertedWithCustomError(oracle, 'InvalidPhaseInitialization')
      })

      it('reverts if phases array does not reach current phase', async () => {
        const initialPhases = [
          { startingVersion: 0, startingRoundId: 0 },
          { startingVersion: 0, startingRoundId: buildChainlinkRoundId(1, 5) },
        ]
        await expect(
          new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, initialPhases),
        ).to.be.revertedWithCustomError(oracle, 'InvalidPhaseInitialization')
      })
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

      it('syncs with new phase with search', async () => {
        // No next round in the current phase
        const phase1NextRound = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 25)
        aggregatorProxy.getRoundData.whenCalledWith(phase1NextRound).reverts()

        // This is the first seen round of the new phase
        // Phase 1 was (36 - 12 + 1) = 25 rounds long (versions 0 to 24)
        // Phase 2 starts at version 25, which is 2 rounds before 1345
        const phase2SwitchoverRound = buildChainlinkRoundId(INITIAL_PHASE + 1, 1343)
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 1, 1345)

        // Setup the binary search logic. If the searched for round is below switchoverRound, then return TIMESTAMP_START
        // If the round is after switchoverRound, return invalid round
        // If the round is switchoverRound, return slightly greater than TIMESTAMP_START
        aggregatorProxy.getRoundData.returns((args: BigNumberish[]) => {
          const roundRequested = BigNumber.from(args[0])
          if (roundRequested.eq(roundId)) {
            return [
              roundId,
              ethers.BigNumber.from(133300000000),
              TIMESTAMP_START + HOUR,
              TIMESTAMP_START + HOUR,
              roundId,
            ]
          } else if (roundRequested.gt(phase2SwitchoverRound)) {
            return [roundRequested, 0, 0, 0, roundRequested]
          } else if (roundRequested.lt(phase2SwitchoverRound)) {
            return [roundRequested, 0, TIMESTAMP_START, TIMESTAMP_START, roundRequested]
          }

          return [
            phase2SwitchoverRound,
            ethers.BigNumber.from(133200000000),
            TIMESTAMP_START + 1,
            TIMESTAMP_START + 1,
            phase2SwitchoverRound,
          ]
        })

        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([
            roundId,
            ethers.BigNumber.from(133300000000),
            TIMESTAMP_START + HOUR,
            TIMESTAMP_START + HOUR,
            roundId,
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

        const atVersion25 = await oracle.atVersion(25)
        expect(atVersion25.price).to.equal(utils.parseEther('1332'))
        expect(atVersion25.timestamp).to.equal(TIMESTAMP_START + 1)
        expect(atVersion25.version).to.equal(25)
      })

      it('syncs with new phase that is 5 greater current phase with search', async () => {
        const phase1NextRound = buildChainlinkRoundId(INITIAL_PHASE, INITIAL_ROUND + 25)
        aggregatorProxy.getRoundData
          .whenCalledWith(phase1NextRound)
          .returns([phase1NextRound, 0, 0, 0, phase1NextRound])

        // This is the first seen round of Phase 6
        // Phase 1 was (36 - 12 + 1) = 25 rounds long (versions 0 to 24)
        // Phase 4 contains version 25
        // Phase 6 starts at version 26
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 5, 345)
        const phase4SwitchoverRound = buildChainlinkRoundId(INITIAL_PHASE + 3, 112)

        // Setup the binary search logic for phase 4
        // If the round is equal to 6,345, return TIMESTAMP_START + HOUR
        // If the round is below    4,112, return TIMESTAMP_START - 1
        // If the round is after    4,112, return TIMESTAMP_START + 2 * HOUR
        // If the round is equal to 4,112, return TIMESTAMP_START + 1
        aggregatorProxy.getRoundData.returns((args: BigNumberish[]) => {
          const roundRequested = BigNumber.from(args[0])
          const phaseRequested = Number(roundRequested.toBigInt() >> BigInt(64))

          if (roundRequested.eq(roundId)) {
            return [
              roundId,
              ethers.BigNumber.from(133300000000),
              TIMESTAMP_START + HOUR,
              TIMESTAMP_START + HOUR,
              roundId,
            ]
          } else if (roundRequested.gt(phase4SwitchoverRound)) {
            return [roundRequested, 0, TIMESTAMP_START + 2 * HOUR, TIMESTAMP_START + 2 * HOUR, roundRequested]
          } else if (roundRequested.lt(phase4SwitchoverRound)) {
            if (phaseRequested < 4 && roundRequested.gt(buildChainlinkRoundId(phaseRequested, 1000))) {
              // Only go 1000 rounds into phase 2 and 3
              return [roundRequested, 0, 0, 0, roundRequested]
            }
            return [roundRequested, 0, TIMESTAMP_START, TIMESTAMP_START, roundRequested]
          }
          return [
            phase4SwitchoverRound,
            ethers.BigNumber.from(133200000000),
            TIMESTAMP_START + 1,
            TIMESTAMP_START + 1,
            phase4SwitchoverRound,
          ]
        })

        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([
            roundId,
            ethers.BigNumber.from(133300000000),
            TIMESTAMP_START + HOUR,
            TIMESTAMP_START + HOUR,
            roundId,
          ])

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

        const atVersion25 = await oracle.atVersion(25)
        expect(atVersion25.price).to.equal(utils.parseEther('1332'))
        expect(atVersion25.timestamp).to.equal(TIMESTAMP_START + 1)
        expect(atVersion25.version).to.equal(25)
      })

      it('reverts on invalid round', async () => {
        const roundId = buildChainlinkRoundId(INITIAL_PHASE + 1, 0)
        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId])

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'InvalidOracleRound')

        aggregatorProxy.latestRoundData
          .whenCalledWith()
          .returns([
            buildChainlinkRoundId(1, 1),
            ethers.BigNumber.from(133300000000),
            0,
            0,
            buildChainlinkRoundId(1, 1),
          ])

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

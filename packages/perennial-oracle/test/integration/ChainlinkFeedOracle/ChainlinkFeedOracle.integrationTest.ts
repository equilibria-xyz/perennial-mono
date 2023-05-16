import { smock, MockContract } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  ChainlinkFeedOracle,
  ChainlinkFeedOracle__factory,
  AggregatorProxyInterface,
  AggregatorProxyInterface__factory,
  PassthroughDataFeed,
  PassthroughDataFeed__factory,
} from '../../../types/generated'
import { reset } from '../../../../common/testutil/time'
import { buildChainlinkRoundId } from '../../../util'

const { ethers, config } = HRE

const PHASE_3_LATEST_ROUND = buildChainlinkRoundId(3, 1234)
const PHASE_4_LATEST_ROUND = buildChainlinkRoundId(4, 543)
const PHASE_5_LATEST_ROUND = buildChainlinkRoundId(5, 28756)

describe('ChainlinkFeedOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let aggregatorProxy: AggregatorProxyInterface
  let aggregatorMock: MockContract<PassthroughDataFeed>
  let oracle: ChainlinkFeedOracle
  beforeEach(async () => {
    await reset(config)
    ;[owner, user] = await ethers.getSigners()
    const aggregatorMockFactory = await smock.mock<PassthroughDataFeed__factory>('PassthroughDataFeed')

    aggregatorProxy = AggregatorProxyInterface__factory.connect('0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', owner)
    aggregatorMock = await aggregatorMockFactory.deploy(aggregatorProxy.address)
    const latestData3 = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND)
    // This is necessary because smock's mocking is buggy for some reason, likely due to naming collisions
    await aggregatorMock._setLatestRoundData(...latestData3)

    oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorMock.address, [])
  })

  describe('#constructor', () => {
    it('sets initial params', async () => {
      expect(await oracle.aggregator()).to.equal(aggregatorMock.address)
    })

    it('returns version 0', async () => {
      const expectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND)
      const atVersion = await oracle.atVersion(0)
      expect(atVersion.price).to.equal(expectedData.answer.mul(10 ** 10))
      expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
      expect(atVersion.version).to.equal(0)
    })

    context('with phases passed in', () => {
      beforeEach(async () => {
        const initialPhases = [
          { startingVersion: 0, startingRoundId: 0 },
          { startingVersion: 0, startingRoundId: 0 },
          { startingVersion: 0, startingRoundId: 0 },
          { startingVersion: 0, startingRoundId: buildChainlinkRoundId(3, 123) },
          { startingVersion: 4, startingRoundId: buildChainlinkRoundId(4, 21) },
          { startingVersion: 12, startingRoundId: buildChainlinkRoundId(5, 20000) },
        ]
        oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorProxy.address, initialPhases)
      })

      it('sets initial params', async () => {
        expect(await oracle.aggregator()).to.equal(aggregatorProxy.address)
      })

      it('returns version 0', async () => {
        const version0Round = buildChainlinkRoundId(3, 123)
        const expectedData = await aggregatorProxy.getRoundData(version0Round)

        const atVersion = await oracle.atVersion(0)
        expect(atVersion.price).to.equal(expectedData.answer.mul(10 ** 10))
        expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(atVersion.version).to.equal(0)
      })

      it('returns a version from a passed in phase', async () => {
        // Round from Phase 4
        const version12Round = buildChainlinkRoundId(5, 20000)
        const expectedData = await aggregatorProxy.getRoundData(version12Round)

        const atVersion = await oracle.atVersion(12)
        expect(atVersion.price).to.equal(expectedData.answer.mul(10 ** 10))
        expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
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
    it('syncs first version', async () => {
      const returnValue = await oracle.callStatic.sync()
      oracle.connect(user).sync()

      const expectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND)
      const expectedPrice = expectedData.answer.mul(10 ** 10)

      expect(returnValue.price).to.equal(expectedPrice)
      expect(returnValue.timestamp).to.equal(expectedData.updatedAt)
      expect(returnValue.version).to.equal(0)

      const currentVersion = await oracle.currentVersion()
      expect(currentVersion.price).to.equal(expectedPrice)
      expect(currentVersion.timestamp).to.equal(expectedData.updatedAt)
      expect(currentVersion.version).to.equal(0)

      const atVersion = await oracle.atVersion(0)
      expect(atVersion.price).to.equal(expectedPrice)
      expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
      expect(atVersion.version).to.equal(0)
    })

    describe('after synced', async () => {
      beforeEach(async () => {
        await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(1))))

        await oracle.connect(user).sync()
      })

      it('doesnt sync new version if not available', async () => {
        const expectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(1))
        const expectedPrice = expectedData.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(expectedData.updatedAt)
        expect(returnValue.version).to.equal(1)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(currentVersion.version).to.equal(1)

        const atVersion = await oracle.atVersion(1)
        expect(atVersion.price).to.equal(expectedPrice)
        expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(atVersion.version).to.equal(1)
      })

      it('syncs new version if available', async () => {
        const expectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(2))
        const expectedPrice = expectedData.answer.mul(10 ** 10)
        await aggregatorMock._setLatestRoundData(...expectedData)

        const returnValue = await oracle.callStatic.sync()
        oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(expectedData.updatedAt)
        expect(returnValue.version).to.equal(2)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(currentVersion.version).to.equal(2)

        const atVersion = await oracle.atVersion(2)
        expect(atVersion.price).to.equal(expectedPrice)
        expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(atVersion.version).to.equal(2)
      })

      it('syncs with new phase', async () => {
        // Sync up to version 3 which is in Phase 3
        await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(3))))
        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3 (there is, which is version 4) so this corresponds to Version 5
        const expectedData = await aggregatorProxy.getRoundData(PHASE_4_LATEST_ROUND.add(1))
        await aggregatorMock._setLatestRoundData(...expectedData)

        const expectedPrice = expectedData.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(expectedData.updatedAt)
        expect(returnValue.version).to.equal(5)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(currentVersion.version).to.equal(5)

        const atVersion5 = await oracle.atVersion(5)
        expect(atVersion5.price).to.equal(expectedPrice)
        expect(atVersion5.timestamp).to.equal(expectedData.updatedAt)
        expect(atVersion5.version).to.equal(5)

        const version4ExpectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(4))
        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(version4ExpectedData.answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(version4ExpectedData.updatedAt)
        expect(atVersion4.version).to.equal(4)
      })

      it('syncs with new phase 2 greater than current', async () => {
        // Sync up to version 3 which is in Phase 3
        await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(3))))
        await oracle.connect(user).sync()

        // Next round comes from phase 5.
        // We check if there is another round in phase 3 (there is, which is version 4) so this corresponds to Version 5
        const expectedData = await aggregatorProxy.getRoundData(PHASE_5_LATEST_ROUND.add(1))
        await aggregatorMock._setLatestRoundData(...expectedData)

        const expectedPrice = expectedData.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(expectedData.updatedAt)
        expect(returnValue.version).to.equal(5)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(expectedData.updatedAt)
        expect(currentVersion.version).to.equal(5)

        const atVersion5 = await oracle.atVersion(5)
        expect(atVersion5.price).to.equal(expectedPrice)
        expect(atVersion5.timestamp).to.equal(expectedData.updatedAt)
        expect(atVersion5.version).to.equal(5)

        const version4ExpectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(4))
        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(version4ExpectedData.answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(version4ExpectedData.updatedAt)
        expect(atVersion4.version).to.equal(4)
      })

      it('syncs with new phase, next round in previous phase after latest round', async () => {
        const p3r1237 = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(3))
        const p3r1238 = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(4))
        const p4r544 = await aggregatorProxy.getRoundData(PHASE_4_LATEST_ROUND.add(1))

        // Sync up to version 3 which is in Phase 3
        await aggregatorMock._setLatestRoundData(...p3r1237)
        aggregatorMock.getRoundData.whenCalledWith(PHASE_3_LATEST_ROUND.add(4)).returns([
          p3r1238.roundId,
          p3r1238.answer,
          p4r544.startedAt, // Force this round to be after the newly synced one
          p4r544.updatedAt,
          p3r1238.roundId,
        ])
        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3
        // There is, but it is after phase4Data[1] so we ignore it and perform a search
        // The search will phase 4 starts at round 2 (version 4), so this is version 4 + (544 - 2) = 546
        await aggregatorMock._setLatestRoundData(...p4r544)

        const expectedPrice = p4r544.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(p4r544.updatedAt)
        expect(returnValue.version).to.equal(546)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(p4r544.updatedAt)
        expect(currentVersion.version).to.equal(546)

        const atVersion5 = await oracle.atVersion(546)
        expect(atVersion5.price).to.equal(expectedPrice)
        expect(atVersion5.timestamp).to.equal(p4r544.updatedAt)
        expect(atVersion5.version).to.equal(546)

        const p4r2 = await aggregatorProxy.getRoundData(buildChainlinkRoundId(4, 2))
        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(p4r2.answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(p4r2.updatedAt)
        expect(atVersion4.version).to.equal(4)

        const atVersion3 = await oracle.atVersion(3)
        expect(atVersion3.price).to.equal(p3r1237.answer.mul(10 ** 10))
        expect(atVersion3.timestamp).to.equal(p3r1237.updatedAt)
        expect(atVersion3.version).to.equal(3)
      })

      it('syncs with new phase with search', async () => {
        const p3r1237 = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(3))
        const p4r544 = await aggregatorProxy.getRoundData(PHASE_4_LATEST_ROUND.add(1))
        aggregatorMock.getRoundData.whenCalledWith(PHASE_3_LATEST_ROUND.add(4)).reverts()

        // Sync up to version 3 which is in Phase 3
        await aggregatorMock._setLatestRoundData(...p3r1237)

        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3
        // There is not
        // The search will find phase 4 starts at round 2 (version 4), so this is version 4 + (544 - 2) = 546
        await aggregatorMock._setLatestRoundData(...p4r544)

        const expectedPrice = p4r544.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(p4r544.updatedAt)
        expect(returnValue.version).to.equal(546)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(p4r544.updatedAt)
        expect(currentVersion.version).to.equal(546)

        const atVersion5 = await oracle.atVersion(546)
        expect(atVersion5.price).to.equal(expectedPrice)
        expect(atVersion5.timestamp).to.equal(p4r544.updatedAt)
        expect(atVersion5.version).to.equal(546)

        const p4r2 = await aggregatorProxy.getRoundData(buildChainlinkRoundId(4, 2))
        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(p4r2.answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(p4r2.updatedAt)
        expect(atVersion4.version).to.equal(4)

        const atVersion3 = await oracle.atVersion(3)
        expect(atVersion3.price).to.equal(p3r1237.answer.mul(10 ** 10))
        expect(atVersion3.timestamp).to.equal(p3r1237.updatedAt)
        expect(atVersion3.version).to.equal(3)
      })

      it('syncs with new phase 2 phases away from the last with search', async () => {
        // Sync up to the very last round in phase 3, version 25380
        const p3rLAST = await aggregatorProxy.getRoundData(buildChainlinkRoundId(3, 26614))
        await aggregatorMock._setLatestRoundData(...p3rLAST)
        await oracle.connect(user).sync()

        // Next round comes from phase 5.
        // The search will not find any phase 4 rounds that are after 3,26614 so then
        // it will search phase 5, and  find it starts at round 16247 (version 25381), so this is version 37890
        const p5r28756 = await aggregatorProxy.getRoundData(PHASE_5_LATEST_ROUND)
        await aggregatorMock._setLatestRoundData(...p5r28756)

        const expectedPrice = p5r28756.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(p5r28756.updatedAt)
        expect(returnValue.version).to.equal(37890)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(p5r28756.updatedAt)
        expect(currentVersion.version).to.equal(37890)

        const atVersionCurrent = await oracle.atVersion(37890)
        expect(atVersionCurrent.price).to.equal(expectedPrice)
        expect(atVersionCurrent.timestamp).to.equal(p5r28756.updatedAt)
        expect(atVersionCurrent.version).to.equal(37890)

        const expectedP5First = await aggregatorProxy.getRoundData(buildChainlinkRoundId(5, 16247))
        const atVersionIntermediary = await oracle.atVersion(25381)
        expect(atVersionIntermediary.price).to.equal(expectedP5First.answer.mul(10 ** 10))
        expect(atVersionIntermediary.timestamp).to.equal(expectedP5First.updatedAt)
        expect(atVersionIntermediary.version).to.equal(25381)

        const atVersionP3Last = await oracle.atVersion(25380)
        expect(atVersionP3Last.price).to.equal(p3rLAST.answer.mul(10 ** 10))
        expect(atVersionP3Last.timestamp).to.equal(p3rLAST.updatedAt)
        expect(atVersionP3Last.version).to.equal(25380)
      })

      it('syncs with new phase 2 phases away from the last with search and intermediary phase', async () => {
        // Sync up to the very last round in phase 3, version 24766
        const p3rLAST = await aggregatorProxy.getRoundData(buildChainlinkRoundId(3, 26000))
        aggregatorMock.getRoundData.whenCalledWith(buildChainlinkRoundId(3, 26001)).reverts()
        await aggregatorMock._setLatestRoundData(...p3rLAST)
        await oracle.connect(user).sync()

        // The search will find that the next phase is 4 which starts at round 757
        // Phase 4 round 757 is version (26000 - 1234) + 1 = 24767
        // This is the first round in phase 5, version 24767
        const p5r28756 = await aggregatorProxy.getRoundData(PHASE_5_LATEST_ROUND)
        await aggregatorMock._setLatestRoundData(...p5r28756)

        const expectedPrice = p5r28756.answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(p5r28756.updatedAt)
        expect(returnValue.version).to.equal(24768)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(p5r28756.updatedAt)
        expect(currentVersion.version).to.equal(24768)

        const atVersionCurrent = await oracle.atVersion(24768)
        expect(atVersionCurrent.price).to.equal(expectedPrice)
        expect(atVersionCurrent.timestamp).to.equal(p5r28756.updatedAt)
        expect(atVersionCurrent.version).to.equal(24768)

        const expectedP4 = await aggregatorProxy.getRoundData(buildChainlinkRoundId(4, 757))
        const atVersionIntermediary = await oracle.atVersion(24767)
        expect(atVersionIntermediary.price).to.equal(expectedP4.answer.mul(10 ** 10))
        expect(atVersionIntermediary.timestamp).to.equal(expectedP4.updatedAt)
        expect(atVersionIntermediary.version).to.equal(24767)

        const atVersionP3Last = await oracle.atVersion(24766)
        expect(atVersionP3Last.price).to.equal(p3rLAST.answer.mul(10 ** 10))
        expect(atVersionP3Last.timestamp).to.equal(p3rLAST.updatedAt)
        expect(atVersionP3Last.version).to.equal(24766)
      })

      it('reverts on invalid round', async () => {
        const roundId = buildChainlinkRoundId(1, 0)
        aggregatorMock.latestRoundData.whenCalledWith().returns([roundId, 123, 123, 123, roundId])

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'InvalidOracleRound')
      })
    })
  })

  describe('#atVersion', async () => {
    beforeEach(async () => {
      await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(3))))
      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const expectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(1))
      const atVersion = await oracle.atVersion(1)
      expect(atVersion.price).to.equal(expectedData.answer.mul(10 ** 10))
      expect(atVersion.timestamp).to.equal(expectedData.updatedAt)
      expect(atVersion.version).to.equal(1)
    })

    it('reads versions in multiple phases', async () => {
      await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(PHASE_4_LATEST_ROUND.add(1))))

      // Syncs from Phase 3 to Phase 4
      await oracle.connect(user).sync()

      // Syncs from beginning of Phase 4 to end (no more rounds in phase 4)
      const phase4lastRound = buildChainlinkRoundId(4, 5056)
      await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(phase4lastRound)))
      await oracle.connect(user).sync()

      await aggregatorMock._setLatestRoundData(...(await aggregatorProxy.getRoundData(buildChainlinkRoundId(5, 2000))))
      // Syncs from Phase 4 to Phase 5
      // Search will find the next round is phase 5, round 1434
      await oracle.connect(user).sync()

      // Check Version from Phase 3: Versions 0 to 4
      // Check last round of phase3
      const v4expectedData = await aggregatorProxy.getRoundData(PHASE_3_LATEST_ROUND.add(4))
      const atVersionPhase3 = await oracle.atVersion(4)
      expect(atVersionPhase3.price).to.equal(v4expectedData.answer.mul(10 ** 10))
      expect(atVersionPhase3.timestamp).to.equal(v4expectedData.updatedAt)
      expect(atVersionPhase3.version).to.equal(4)

      // Check Version from Phase 4: Versions 5 to end
      // Check first round of phase4
      const v5expectedData = await aggregatorProxy.getRoundData(PHASE_4_LATEST_ROUND.add(1))
      const atVersionPhase4 = await oracle.atVersion(5)
      expect(atVersionPhase4.price).to.equal(v5expectedData.answer.mul(10 ** 10))
      expect(atVersionPhase4.timestamp).to.equal(v5expectedData.updatedAt)
      expect(atVersionPhase4.version).to.equal(5)

      // Check last round of phase4
      // Phase 4 is (5056-544)=4512 rounds long and starts at version 5, so this is version 5+4512=4517
      const phase4LastExpectedData = await aggregatorProxy.getRoundData(phase4lastRound)
      const atVersionPhase4Last = await oracle.atVersion(4517)
      expect(atVersionPhase4Last.price).to.equal(phase4LastExpectedData.answer.mul(10 ** 10))
      expect(atVersionPhase4Last.timestamp).to.equal(phase4LastExpectedData.updatedAt)
      expect(atVersionPhase4Last.version).to.equal(4517)

      // Check Version from Phase 5: Versions 4518 onwards
      // Check first round of phase 5, which is round 1434 found by the binary search
      const v9expectedData = await aggregatorProxy.getRoundData(buildChainlinkRoundId(5, 1434))
      const atVersionPhase5 = await oracle.atVersion(4518)
      expect(atVersionPhase5.price).to.equal(v9expectedData.answer.mul(10 ** 10))
      expect(atVersionPhase5.timestamp).to.equal(v9expectedData.updatedAt)
      expect(atVersionPhase5.version).to.equal(4518)
    })
  })
})

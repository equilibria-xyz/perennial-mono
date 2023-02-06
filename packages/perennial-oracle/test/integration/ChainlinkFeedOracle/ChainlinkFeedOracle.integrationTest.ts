import { smock, FakeContract } from '@defi-wonderland/smock'
import { BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  ChainlinkFeedOracle,
  ChainlinkFeedOracle__factory,
  AggregatorProxyInterface,
  AggregatorProxyInterface__factory,
} from '../../../types/generated'
import { reset } from '../../../../common/testutil/time'
import { buildChainlinkRoundId } from '../../../util'

const { ethers, config } = HRE

type ChainlinkRound = [BigNumber, BigNumber, BigNumber, BigNumber, BigNumber] & {
  roundId: BigNumber
  answer: BigNumber
  startedAt: BigNumber
  updatedAt: BigNumber
  answeredInRound: BigNumber
}
const PHASE_3_STARTING_ROUND = buildChainlinkRoundId(3, 1234)
const PHASE_4_STARTING_ROUND = buildChainlinkRoundId(4, 543)
const PHASE_5_STARTING_ROUND = buildChainlinkRoundId(5, 756)

describe('ChainlinkFeedOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let aggregatorProxy: AggregatorProxyInterface
  let aggregatorFake: FakeContract<AggregatorProxyInterface>
  let oracle: ChainlinkFeedOracle
  const phase3Data: ChainlinkRound[] = []
  const phase4Data: ChainlinkRound[] = []
  const phase5Data: ChainlinkRound[] = []

  beforeEach(async () => {
    await reset(config)
    ;[owner, user] = await ethers.getSigners()
    aggregatorProxy = await AggregatorProxyInterface__factory.connect(
      '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      owner,
    )
    aggregatorFake = await smock.fake<AggregatorProxyInterface>(AggregatorProxyInterface__factory.abi)
    aggregatorFake.decimals.returns(await aggregatorProxy.decimals())

    // Load 5 rounds of phase 3
    for (let i = 0; i < 5; i++) {
      phase3Data.push(await aggregatorProxy.getRoundData(PHASE_3_STARTING_ROUND.add(i)))
      aggregatorFake.getRoundData.whenCalledWith(PHASE_3_STARTING_ROUND.add(i)).returns(phase3Data[i])
    }

    // Load 5 rounds of phase 4
    for (let i = 0; i < 5; i++) {
      phase4Data.push(await aggregatorProxy.getRoundData(PHASE_4_STARTING_ROUND.add(i)))
      aggregatorFake.getRoundData.whenCalledWith(PHASE_4_STARTING_ROUND.add(i)).returns(phase4Data[i])
    }

    // Load 5 rounds of phase 5
    for (let i = 0; i < 5; i++) {
      phase5Data.push(await aggregatorProxy.getRoundData(PHASE_5_STARTING_ROUND.add(i)))
      aggregatorFake.getRoundData.whenCalledWith(PHASE_5_STARTING_ROUND.add(i)).returns(phase5Data[i])
    }

    aggregatorFake.latestRoundData.returns(phase3Data[0])
    oracle = await new ChainlinkFeedOracle__factory(owner).deploy(aggregatorFake.address)
  })

  describe('#constructor', () => {
    it('sets initial params', async () => {
      expect(await oracle.aggregator()).to.equal(aggregatorFake.address)
    })

    it('returns version 0', async () => {
      const atVersion = await oracle.atVersion(0)
      expect(atVersion.price).to.equal(phase3Data[0].answer.mul(10 ** 10))
      expect(atVersion.timestamp).to.equal(phase3Data[0].updatedAt)
      expect(atVersion.version).to.equal(0)
    })
  })

  describe('#sync', () => {
    it('syncs first version', async () => {
      const returnValue = await oracle.callStatic.sync()
      oracle.connect(user).sync()

      const expectedPrice = phase3Data[0].answer.mul(10 ** 10)

      expect(returnValue.price).to.equal(expectedPrice)
      expect(returnValue.timestamp).to.equal(phase3Data[0].updatedAt)
      expect(returnValue.version).to.equal(0)

      const currentVersion = await oracle.currentVersion()
      expect(currentVersion.price).to.equal(expectedPrice)
      expect(currentVersion.timestamp).to.equal(phase3Data[0].updatedAt)
      expect(currentVersion.version).to.equal(0)

      const atVersion = await oracle.atVersion(0)
      expect(atVersion.price).to.equal(expectedPrice)
      expect(atVersion.timestamp).to.equal(phase3Data[0].updatedAt)
      expect(atVersion.version).to.equal(0)
    })

    describe('after synced', async () => {
      beforeEach(async () => {
        aggregatorFake.latestRoundData.returns(phase3Data[1])

        await oracle.connect(user).sync()
      })

      it('doesnt sync new version if not available', async () => {
        const expectedPrice = phase3Data[1].answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(phase3Data[1].updatedAt)
        expect(returnValue.version).to.equal(1)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(phase3Data[1].updatedAt)
        expect(currentVersion.version).to.equal(1)

        const atVersion = await oracle.atVersion(1)
        expect(atVersion.price).to.equal(expectedPrice)
        expect(atVersion.timestamp).to.equal(phase3Data[1].updatedAt)
        expect(atVersion.version).to.equal(1)
      })

      it('syncs new version if available', async () => {
        const expectedPrice = phase3Data[2].answer.mul(10 ** 10)
        aggregatorFake.latestRoundData.returns(phase3Data[2])

        const returnValue = await oracle.callStatic.sync()
        oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(phase3Data[2].updatedAt)
        expect(returnValue.version).to.equal(2)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(phase3Data[2].updatedAt)
        expect(currentVersion.version).to.equal(2)

        const atVersion = await oracle.atVersion(2)
        expect(atVersion.price).to.equal(expectedPrice)
        expect(atVersion.timestamp).to.equal(phase3Data[2].updatedAt)
        expect(atVersion.version).to.equal(2)
      })

      it('syncs with new phase', async () => {
        // Sync up to version 3 which is in Phase 3
        aggregatorFake.latestRoundData.returns(phase3Data[3])
        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3 (there is, which is version 4) so this corresponds to Version 5
        aggregatorFake.latestRoundData.returns(phase4Data[1])

        const expectedPrice = phase4Data[1].answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(returnValue.version).to.equal(5)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(currentVersion.version).to.equal(5)

        const atVersion5 = await oracle.atVersion(5)
        expect(atVersion5.price).to.equal(expectedPrice)
        expect(atVersion5.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(atVersion5.version).to.equal(5)

        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(phase3Data[4].answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(phase3Data[4].updatedAt)
        expect(atVersion4.version).to.equal(4)
      })

      it('syncs with new phase, next round in previous phase after latest round', async () => {
        // Sync up to version 3 which is in Phase 3
        aggregatorFake.latestRoundData.returns(phase3Data[3])
        aggregatorFake.getRoundData.whenCalledWith(phase3Data[4].roundId).returns([
          phase3Data[4].roundId,
          phase3Data[4].answer,
          phase4Data[1].startedAt, // Force this round to be after the newly synced one
          phase4Data[1].updatedAt,
          phase3Data[4].roundId,
        ])
        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3
        // There is, but it is after phase4Data[1] so we ignore it and perform a walkback
        // The walkback goes back 1 round in the new phase, so this is version 5
        aggregatorFake.latestRoundData.returns(phase4Data[1])

        const expectedPrice = phase4Data[1].answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(returnValue.version).to.equal(5)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(currentVersion.version).to.equal(5)

        const atVersion5 = await oracle.atVersion(5)
        expect(atVersion5.price).to.equal(expectedPrice)
        expect(atVersion5.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(atVersion5.version).to.equal(5)

        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(phase4Data[0].answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(phase4Data[0].updatedAt)
        expect(atVersion4.version).to.equal(4)

        const atVersion3 = await oracle.atVersion(3)
        expect(atVersion3.price).to.equal(phase3Data[3].answer.mul(10 ** 10))
        expect(atVersion3.timestamp).to.equal(phase3Data[3].updatedAt)
        expect(atVersion3.version).to.equal(3)
      })

      it('syncs with new phase with walkback', async () => {
        // Sync up to version 4 which is in Phase 3
        aggregatorFake.latestRoundData.returns(phase3Data[4])
        aggregatorFake.getRoundData.whenCalledWith(PHASE_3_STARTING_ROUND.add(5)).reverts()
        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3 (there is not)
        // so this corresponds to Version 6 and phase4Data[0] is version 5
        aggregatorFake.latestRoundData.returns(phase4Data[1])

        const expectedPrice = phase4Data[1].answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(returnValue.version).to.equal(6)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(currentVersion.version).to.equal(6)

        const atVersion6 = await oracle.atVersion(6)
        expect(atVersion6.price).to.equal(expectedPrice)
        expect(atVersion6.timestamp).to.equal(phase4Data[1].updatedAt)
        expect(atVersion6.version).to.equal(6)

        const atVersion5 = await oracle.atVersion(5)
        expect(atVersion5.price).to.equal(phase4Data[0].answer.mul(10 ** 10))
        expect(atVersion5.timestamp).to.equal(phase4Data[0].updatedAt)
        expect(atVersion5.version).to.equal(5)

        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(phase3Data[4].answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(phase3Data[4].updatedAt)
        expect(atVersion4.version).to.equal(4)
      })

      it('syncs with new phase with multi-walkback', async () => {
        // Sync up to version 4 which is in Phase 3
        aggregatorFake.latestRoundData.returns(phase3Data[4])
        aggregatorFake.getRoundData.whenCalledWith(PHASE_3_STARTING_ROUND.add(5)).reverts()
        await oracle.connect(user).sync()

        // Next round comes from phase 4.
        // We check if there is another round in phase 3 (there is not)

        // Allow the walkback to stop at phase4Data[1] making phase4Data[2] the start of the phase
        aggregatorFake.getRoundData
          .whenCalledWith(PHASE_4_STARTING_ROUND.add(1))
          .returns([
            phase4Data[1].roundId,
            phase4Data[1].answer,
            phase3Data[4].startedAt.sub(5),
            phase3Data[4].updatedAt.sub(5),
            phase4Data[1].answeredInRound,
          ])

        // Due to the walkback, phase4 starts at phase4Data[2], so this is version 7
        aggregatorFake.latestRoundData.returns(phase4Data[4])

        const expectedPrice = phase4Data[4].answer.mul(10 ** 10)
        const returnValue = await oracle.callStatic.sync()
        await oracle.connect(user).sync()

        expect(returnValue.price).to.equal(expectedPrice)
        expect(returnValue.timestamp).to.equal(phase4Data[4].updatedAt)
        expect(returnValue.version).to.equal(7)

        const currentVersion = await oracle.currentVersion()
        expect(currentVersion.price).to.equal(expectedPrice)
        expect(currentVersion.timestamp).to.equal(phase4Data[4].updatedAt)
        expect(currentVersion.version).to.equal(7)

        const atVersion7 = await oracle.atVersion(7)
        expect(atVersion7.price).to.equal(expectedPrice)
        expect(atVersion7.timestamp).to.equal(phase4Data[4].updatedAt)
        expect(atVersion7.version).to.equal(7)

        const atVersion6 = await oracle.atVersion(6)
        expect(atVersion6.price).to.equal(phase4Data[3].answer.mul(10 ** 10))
        expect(atVersion6.timestamp).to.equal(phase4Data[3].updatedAt)
        expect(atVersion6.version).to.equal(6)

        const atVersion5 = await oracle.atVersion(5)
        expect(atVersion5.price).to.equal(phase4Data[2].answer.mul(10 ** 10))
        expect(atVersion5.timestamp).to.equal(phase4Data[2].updatedAt)
        expect(atVersion5.version).to.equal(5)

        const atVersion4 = await oracle.atVersion(4)
        expect(atVersion4.price).to.equal(phase3Data[4].answer.mul(10 ** 10))
        expect(atVersion4.timestamp).to.equal(phase3Data[4].updatedAt)
        expect(atVersion4.version).to.equal(4)
      })

      it('reverts if syncing multiple phases in a single sync call', async () => {
        aggregatorFake.latestRoundData.returns(phase5Data[0])

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'UnableToSyncError')
      })

      it('reverts on invalid round', async () => {
        const roundId = buildChainlinkRoundId(1, 0)
        aggregatorFake.latestRoundData
          .whenCalledWith()
          .returns([roundId, phase3Data[0].answer, phase3Data[0].startedAt, phase3Data[0].updatedAt, roundId])

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'InvalidOracleRound')
      })
    })
  })

  describe('#atVersion', async () => {
    beforeEach(async () => {
      aggregatorFake.latestRoundData.returns(phase3Data[3])
      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const atVersion = await oracle.atVersion(1)
      expect(atVersion.price).to.equal(phase3Data[1].answer.mul(10 ** 10))
      expect(atVersion.timestamp).to.equal(phase3Data[1].updatedAt)
      expect(atVersion.version).to.equal(1)
    })

    it('reads versions in multiple phases', async () => {
      // Phase 1 is Versions 0 -> 4
      // Phase 2 starts at Version 5
      aggregatorFake.latestRoundData.returns(phase4Data[1])

      // Syncs from Phase 3 to Phase 4
      await oracle.connect(user).sync()

      // Syncs from beginning of Phase 4 to end (no more rounds in phase 4)
      aggregatorFake.latestRoundData.returns(phase4Data[4])
      await oracle.connect(user).sync()

      // Phase2 goes from versions 5 to 8
      // Start Phase 5, since we triggered a walkback
      // phase5Data[0] is the starting round of the new phase
      aggregatorFake.latestRoundData.returns(phase5Data[1])
      // Syncs from Phase 4 to Phase 5
      await oracle.connect(user).sync()

      // Check Version from Phase 3: Versions 0 to 4
      // Check last round of phase3
      const atVersionPhase3 = await oracle.atVersion(4)
      expect(atVersionPhase3.price).to.equal(phase3Data[4].answer.mul(10 ** 10))
      expect(atVersionPhase3.timestamp).to.equal(phase3Data[4].updatedAt)
      expect(atVersionPhase3.version).to.equal(4)

      // Check Version from Phase 4: Versions 5 to 8
      // Check first round of phase4
      const atVersionPhase4 = await oracle.atVersion(5)
      expect(atVersionPhase4.price).to.equal(phase4Data[1].answer.mul(10 ** 10))
      expect(atVersionPhase4.timestamp).to.equal(phase4Data[1].updatedAt)
      expect(atVersionPhase4.version).to.equal(5)

      // Check last round of phase4
      const atVersionPhase4Last = await oracle.atVersion(8)
      expect(atVersionPhase4Last.price).to.equal(phase4Data[4].answer.mul(10 ** 10))
      expect(atVersionPhase4Last.timestamp).to.equal(phase4Data[4].updatedAt)
      expect(atVersionPhase4Last.version).to.equal(8)

      // Check Version from Phase 5: Versions 9 onwards
      // Check first round of phase 5
      const atVersionPhase5 = await oracle.atVersion(9)
      expect(atVersionPhase5.price).to.equal(phase5Data[0].answer.mul(10 ** 10))
      expect(atVersionPhase5.timestamp).to.equal(phase5Data[0].updatedAt)
      expect(atVersionPhase5.version).to.equal(9)
    })
  })
})

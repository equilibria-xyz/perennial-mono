import { MockContract, deployMockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { ChainlinkOracle, ChainlinkOracle__factory, FeedRegistryInterface__factory } from '../../../types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { buildChainlinkRoundId } from '../../../util'

const { ethers } = HRE

const HOUR = 60 * 60

describe('ChainlinkOracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let eth: SignerWithAddress
  let usd: SignerWithAddress

  let registry: MockContract

  let oracle: ChainlinkOracle

  beforeEach(async () => {
    ;[owner, user, eth, usd] = await ethers.getSigners()
    registry = await deployMockContract(owner, FeedRegistryInterface__factory.abi)
    await registry.mock.decimals.withArgs(eth.address, usd.address).returns(8)
    await registry.mock.getPhaseRange
      .withArgs(eth.address, usd.address, 1)
      .returns(buildChainlinkRoundId(1, 100), buildChainlinkRoundId(1, 500))
    oracle = await new ChainlinkOracle__factory(owner).deploy(registry.address, eth.address, usd.address, {
      gasLimit: 3e6,
    })
  })

  describe('#constructor', async () => {
    it('sets initial params', async () => {
      expect(await oracle.registry()).to.equal(registry.address)
      expect(await oracle.base()).to.equal(eth.address)
      expect(await oracle.quote()).to.equal(usd.address)
    })
  })

  describe('#sync', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()
    })

    it('syncs first version', async () => {
      const roundId = buildChainlinkRoundId(1, 123)
      await registry.mock.latestRoundData
        .withArgs(eth.address, usd.address)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundId)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

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
        const roundId = buildChainlinkRoundId(1, 123)

        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

        await oracle.connect(user).sync()
      })

      it('doesnt sync new version if not available', async () => {
        const roundId = buildChainlinkRoundId(1, 123)
        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

        await registry.mock.getRoundData
          .withArgs(eth.address, usd.address, roundId)
          .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

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
        const roundId = buildChainlinkRoundId(1, 124)
        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(122200000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

        await registry.mock.getRoundData
          .withArgs(eth.address, usd.address, roundId)
          .returns(roundId, ethers.BigNumber.from(122200000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

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
        await registry.mock.getPhaseRange
          .withArgs(eth.address, usd.address, 2)
          .returns(buildChainlinkRoundId(2, 320), buildChainlinkRoundId(2, 700))

        const roundId = buildChainlinkRoundId(2, 345)
        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

        await registry.mock.getRoundData
          .withArgs(eth.address, usd.address, roundId)
          .returns(roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

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

      it('syncs with an empty phase', async () => {
        await registry.mock.getPhaseRange
          .withArgs(eth.address, usd.address, 2)
          .returns(buildChainlinkRoundId(2, 0), buildChainlinkRoundId(2, 0))

        await registry.mock.getPhaseRange
          .withArgs(eth.address, usd.address, 3)
          .returns(buildChainlinkRoundId(3, 320), buildChainlinkRoundId(3, 700))

        const roundId = buildChainlinkRoundId(3, 345)
        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

        await registry.mock.getRoundData
          .withArgs(eth.address, usd.address, roundId)
          .returns(roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

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

      it('reverts on invalid round', async () => {
        const roundId = buildChainlinkRoundId(2, 0)
        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(133300000000), TIMESTAMP_START, TIMESTAMP_START + HOUR, roundId)

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'InvalidOracleRound')

        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(buildChainlinkRoundId(1, 1), ethers.BigNumber.from(133300000000), 0, 0, buildChainlinkRoundId(1, 1))

        await expect(oracle.connect(user).sync()).to.be.revertedWithCustomError(oracle, 'InvalidOracleRound')
      })
    })
  })

  describe('#atVersion', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      const roundId = buildChainlinkRoundId(1, 123)

      await registry.mock.latestRoundData
        .withArgs(eth.address, usd.address)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const roundId = buildChainlinkRoundId(1, 112)

      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundId)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

      const atVersion = await oracle.atVersion(12)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(12)
    })

    it('reads versions in multiple phases', async () => {
      const currentRoundId = buildChainlinkRoundId(3, 350)

      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 2)
        .returns(buildChainlinkRoundId(2, 301), buildChainlinkRoundId(2, 600))
      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 3)
        .returns(buildChainlinkRoundId(3, 100), buildChainlinkRoundId(3, 500))

      await registry.mock.latestRoundData
        .withArgs(eth.address, usd.address)
        .returns(
          currentRoundId,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START,
          currentRoundId,
        )

      // Syncs from Phase 1 to Phase 3
      await oracle.connect(user).sync()

      // Check Version from Phase 1: Versions 0 to 400
      const roundIdPhase1 = buildChainlinkRoundId(1, 112)
      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundIdPhase1)
        .returns(
          roundIdPhase1,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - 6 * HOUR,
          TIMESTAMP_START - 5 * HOUR,
          roundIdPhase1,
        )
      const atVersionPhase1 = await oracle.atVersion(12)
      expect(atVersionPhase1.price).to.equal(utils.parseEther('1111'))
      expect(atVersionPhase1.timestamp).to.equal(TIMESTAMP_START - 5 * HOUR)
      expect(atVersionPhase1.version).to.equal(12)

      // Check Version from Phase 2: Versions 401 to 700
      const roundIdPhase2 = buildChainlinkRoundId(2, 600)
      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundIdPhase2)
        .returns(
          roundIdPhase2,
          ethers.BigNumber.from(123400000000),
          TIMESTAMP_START - 3 * HOUR,
          TIMESTAMP_START - 2 * HOUR,
          roundIdPhase2,
        )
      const atVersion2 = await oracle.atVersion(700)
      expect(atVersion2.price).to.equal(utils.parseEther('1234'))
      expect(atVersion2.timestamp).to.equal(TIMESTAMP_START - 2 * HOUR)
      expect(atVersion2.version).to.equal(700)

      // Check Version from Phase 3: Versions 701 onwards
      const roundIdPhase3 = buildChainlinkRoundId(3, 100)
      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundIdPhase3)
        .returns(
          roundIdPhase3,
          ethers.BigNumber.from(211100000000),
          TIMESTAMP_START - 2 * HOUR,
          TIMESTAMP_START - 1 * HOUR,
          roundIdPhase3,
        )
      const atVersion3 = await oracle.atVersion(701)
      expect(atVersion3.price).to.equal(utils.parseEther('2111'))
      expect(atVersion3.timestamp).to.equal(TIMESTAMP_START - 1 * HOUR)
      expect(atVersion3.version).to.equal(701)
    })

    it('reads versions in multiple phases with empty phase', async () => {
      const currentRoundId = buildChainlinkRoundId(4, 350)

      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 2)
        .returns(buildChainlinkRoundId(2, 301), buildChainlinkRoundId(2, 600))
      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 3)
        .returns(buildChainlinkRoundId(3, 0), buildChainlinkRoundId(3, 0))
      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 4)
        .returns(buildChainlinkRoundId(4, 100), buildChainlinkRoundId(4, 500))

      await registry.mock.latestRoundData
        .withArgs(eth.address, usd.address)
        .returns(
          currentRoundId,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START,
          currentRoundId,
        )

      // Syncs from Phase 1 to Phase 4
      await oracle.connect(user).sync()

      // Check Version from Phase 1: Versions 0 to 400
      const roundIdPhase1 = buildChainlinkRoundId(1, 112)
      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundIdPhase1)
        .returns(
          roundIdPhase1,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - 6 * HOUR,
          TIMESTAMP_START - 5 * HOUR,
          roundIdPhase1,
        )
      const atVersionPhase1 = await oracle.atVersion(12)
      expect(atVersionPhase1.price).to.equal(utils.parseEther('1111'))
      expect(atVersionPhase1.timestamp).to.equal(TIMESTAMP_START - 5 * HOUR)
      expect(atVersionPhase1.version).to.equal(12)

      // Check Version from Phase 2: Versions 401 to 700
      const roundIdPhase2 = buildChainlinkRoundId(2, 600)
      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundIdPhase2)
        .returns(
          roundIdPhase2,
          ethers.BigNumber.from(123400000000),
          TIMESTAMP_START - 3 * HOUR,
          TIMESTAMP_START - 2 * HOUR,
          roundIdPhase2,
        )
      const atVersion2 = await oracle.atVersion(700)
      expect(atVersion2.price).to.equal(utils.parseEther('1234'))
      expect(atVersion2.timestamp).to.equal(TIMESTAMP_START - 2 * HOUR)
      expect(atVersion2.version).to.equal(700)

      // Check Version from Phase 4: Versions 701 onwards
      const roundIdPhase4 = buildChainlinkRoundId(4, 100)
      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundIdPhase4)
        .returns(
          roundIdPhase4,
          ethers.BigNumber.from(211100000000),
          TIMESTAMP_START - 2 * HOUR,
          TIMESTAMP_START - 1 * HOUR,
          roundIdPhase4,
        )
      const atVersion4 = await oracle.atVersion(701)
      expect(atVersion4.price).to.equal(utils.parseEther('2111'))
      expect(atVersion4.timestamp).to.equal(TIMESTAMP_START - 1 * HOUR)
      expect(atVersion4.version).to.equal(701)
    })
  })
})

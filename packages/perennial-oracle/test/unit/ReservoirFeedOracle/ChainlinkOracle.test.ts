import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import { ChainlinkOracle, ChainlinkOracle__factory, FeedRegistryInterface__factory } from '../../../types/generated'
import { currentBlockTimestamp } from '../../../../common/testutil/time'
import { buildRoundId } from '../../../util'

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
    registry = await waffle.deployMockContract(owner, FeedRegistryInterface__factory.abi)
  })

  describe('#constructor', async () => {
    it('sets initial params', async () => {
      await registry.mock.decimals.withArgs(eth.address, usd.address).returns(8)

      oracle = await new ChainlinkOracle__factory(owner).deploy(registry.address, eth.address, usd.address)

      expect(await oracle.registry()).to.equal(registry.address)
      expect(await oracle.base()).to.equal(eth.address)
      expect(await oracle.quote()).to.equal(usd.address)
    })
  })

  describe('#sync', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      await registry.mock.decimals.withArgs(eth.address, usd.address).returns(8)
      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 1)
        .returns(buildRoundId(1, 100), buildRoundId(1, 500))
      oracle = await new ChainlinkOracle__factory(owner).deploy(registry.address, eth.address, usd.address)
    })

    it('syncs first version', async () => {
      const roundId = buildRoundId(1, 123)
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
        const roundId = buildRoundId(1, 123)

        await registry.mock.latestRoundData
          .withArgs(eth.address, usd.address)
          .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

        await oracle.connect(user).sync()
      })

      it('doesnt sync new version if not available', async () => {
        const roundId = buildRoundId(1, 123)
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
        const roundId = buildRoundId(1, 124)
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
          .returns(buildRoundId(2, 320), buildRoundId(2, 700))

        const roundId = buildRoundId(2, 345)
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
    })
  })

  describe('#atVersion', async () => {
    let TIMESTAMP_START: number

    beforeEach(async () => {
      TIMESTAMP_START = await currentBlockTimestamp()

      await registry.mock.decimals.withArgs(eth.address, usd.address).returns(8)
      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 1)
        .returns(buildRoundId(1, 100), buildRoundId(1, 500))
      oracle = await new ChainlinkOracle__factory(owner).deploy(registry.address, eth.address, usd.address)

      const roundId = buildRoundId(1, 123)

      await registry.mock.latestRoundData
        .withArgs(eth.address, usd.address)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

      await oracle.connect(user).sync()
    })

    it('reads prior version', async () => {
      const roundId = buildRoundId(1, 112)

      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundId)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

      const atVersion = await oracle.atVersion(12)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(12)
    })

    it('reads prior version in prior phase', async () => {
      const currentRoundId = buildRoundId(2, 345)

      await registry.mock.getPhaseRange
        .withArgs(eth.address, usd.address, 2)
        .returns(buildRoundId(2, 320), buildRoundId(2, 700))

      await registry.mock.latestRoundData
        .withArgs(eth.address, usd.address)
        .returns(
          currentRoundId,
          ethers.BigNumber.from(111100000000),
          TIMESTAMP_START - HOUR,
          TIMESTAMP_START,
          currentRoundId,
        )

      await oracle.connect(user).sync()

      const roundId = buildRoundId(1, 112)

      await registry.mock.getRoundData
        .withArgs(eth.address, usd.address, roundId)
        .returns(roundId, ethers.BigNumber.from(111100000000), TIMESTAMP_START - HOUR, TIMESTAMP_START, roundId)

      const atVersion = await oracle.atVersion(12)
      expect(atVersion.price).to.equal(utils.parseEther('1111'))
      expect(atVersion.timestamp).to.equal(TIMESTAMP_START)
      expect(atVersion.version).to.equal(12)
    })
  })
})

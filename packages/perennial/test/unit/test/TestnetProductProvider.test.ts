import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import {
  IOracleProvider__factory,
  TestnetProductProvider,
  TestnetProductProvider__factory,
} from '../../../types/generated'

const { ethers } = HRE

const TIMESTAMP = 1636920000
const CURVE = {
  minRate: 0,
  maxRate: utils.parseEther('5.00'),
  targetRate: utils.parseEther('0.80'),
  targetUtilization: utils.parseEther('0.80'),
}

describe('TestnetProductProvider', () => {
  let user: SignerWithAddress
  let oracle: MockContract
  let testnetProductProvider: TestnetProductProvider

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(user, IOracleProvider__factory.abi)
    testnetProductProvider = await new TestnetProductProvider__factory(user).deploy(oracle.address, CURVE)
  })

  describe('#name', async () => {
    it('returns correct name', async () => {
      expect(await testnetProductProvider.name()).to.equal('Squeeth')
    })
  })

  describe('#symbol', async () => {
    it('returns correct symbol', async () => {
      expect(await testnetProductProvider.symbol()).to.equal('SQTH')
    })
  })

  describe('#sync', async () => {
    it('calls sync on oracle', async () => {
      await oracle.mock.sync.withArgs().returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 1,
      })

      await testnetProductProvider.connect(user).sync()
    })
  })

  describe('#currentVersion', async () => {
    it('modifies oracle per payoff', async () => {
      await oracle.mock.currentVersion.withArgs().returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 2,
      })

      const oracleVersion = await testnetProductProvider.currentVersion()
      expect(oracleVersion.price).to.equal(utils.parseEther('121'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(2)
    })
  })

  describe('#atVersion', async () => {
    it('modifies oracle per payoff', async () => {
      await oracle.mock.atVersion.withArgs(2).returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 2,
      })

      const oracleVersion = await testnetProductProvider.atVersion(2)
      expect(oracleVersion.price).to.equal(utils.parseEther('121'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(2)
    })
  })

  describe('#rate', async () => {
    const SECONDS_IN_YEAR = 60 * 60 * 24 * 365

    it('handles zero maker', async () => {
      expect(await testnetProductProvider.rate({ maker: 0, taker: 0 })).to.equal(
        utils.parseEther('5.00').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 0, taker: 100 })).to.equal(
        utils.parseEther('5.00').div(SECONDS_IN_YEAR),
      )
    })

    it('returns the proper rate from utilization', async () => {
      expect(await testnetProductProvider.rate({ maker: 100, taker: 0 })).to.equal(
        utils.parseEther('0.00').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 100, taker: 25 })).to.equal(
        utils.parseEther('0.25').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 100, taker: 50 })).to.equal(
        utils.parseEther('0.50').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 100, taker: 75 })).to.equal(
        utils.parseEther('0.75').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 100, taker: 90 })).to.equal(
        utils.parseEther('2.90').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 100, taker: 100 })).to.equal(
        utils.parseEther('5.00').div(SECONDS_IN_YEAR),
      )
      expect(await testnetProductProvider.rate({ maker: 100, taker: 125 })).to.equal(
        utils.parseEther('5.00').div(SECONDS_IN_YEAR),
      )
    })
  })

  describe('#maintenance', async () => {
    it('returns correct maintenance', async () => {
      expect(await testnetProductProvider.maintenance()).to.equal(utils.parseEther('0.3'))
    })
  })

  describe('#fundingFee', async () => {
    it('returns correct fundingFee', async () => {
      expect(await testnetProductProvider.fundingFee()).to.equal(utils.parseEther('0.1'))
    })
  })

  describe('#makerFee', async () => {
    it('returns correct makerFee', async () => {
      expect(await testnetProductProvider.makerFee()).to.equal(utils.parseEther('0'))
    })
  })

  describe('#takerFee', async () => {
    it('returns correct takerFee', async () => {
      expect(await testnetProductProvider.takerFee()).to.equal(utils.parseEther('0'))
    })
  })

  describe('#makerLimit', async () => {
    it('returns correct makerLimit', async () => {
      expect(await testnetProductProvider.makerLimit()).to.equal(utils.parseEther('1'))
    })
  })
})

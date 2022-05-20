import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import { IOracleProvider__factory, Gas, Gas__factory } from '../../../types/generated'

const { ethers } = HRE

const TIMESTAMP = 1636920000

describe('Gas', () => {
  let user: SignerWithAddress
  let oracle: MockContract
  let gas: Gas

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(user, IOracleProvider__factory.abi)
    gas = await new Gas__factory(user).deploy(
      oracle.address,
      utils.parseEther('1.00'),
      utils.parseEther('0.10'),
      utils.parseEther('0'),
      utils.parseEther('0'),
      utils.parseEther('1000'),
      {
        minRate: utils.parseEther('-1.00'),
        maxRate: utils.parseEther('1.00'),
        targetRate: utils.parseEther('0.25'),
        targetUtilization: utils.parseEther('0.80'),
      },
    )
  })

  describe('#name', async () => {
    it('returns correct name', async () => {
      expect(await gas.name()).to.equal('Gas Price Index')
    })
  })

  describe('#symbol', async () => {
    it('returns correct symbol', async () => {
      expect(await gas.symbol()).to.equal('GAS')
    })
  })

  describe('#oracle', async () => {
    it('returns correct oracle', async () => {
      expect(await gas.oracle()).to.equal(oracle.address)
    })
  })

  describe('#sync', async () => {
    it('calls sync on oracle', async () => {
      await oracle.mock.sync.withArgs().returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 1,
      })

      const result = await gas.connect(user).callStatic.sync()
      await gas.connect(user).sync()

      expect(result.price).to.equal(utils.parseEther('11'))
      expect(result.timestamp).to.equal(TIMESTAMP)
      expect(result.version).to.equal(1)
    })
  })

  describe('#atVersion', async () => {
    it('modifies oracle per payoff', async () => {
      await oracle.mock.atVersion.withArgs(1).returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 1,
      })

      const oracleVersion = await gas.atVersion(1)
      expect(oracleVersion.price).to.equal(utils.parseEther('11'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(1)
    })
  })

  describe('#currentVersion', async () => {
    it('modifies oracle per payoff', async () => {
      await oracle.mock.atVersion.withArgs(2).returns({
        price: utils.parseEther('22'),
        timestamp: TIMESTAMP,
        version: 2,
      })

      const oracleVersion = await gas.atVersion(2)
      expect(oracleVersion.price).to.equal(utils.parseEther('22'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(2)
    })
  })

  describe('#rate', async () => {
    const SECONDS_IN_YEAR = 60 * 60 * 24 * 365

    it('handles zero maker', async () => {
      expect(await gas.rate({ maker: 0, taker: 0 })).to.equal(utils.parseEther('1.00').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 0, taker: 100 })).to.equal(utils.parseEther('1.00').div(SECONDS_IN_YEAR))
    })

    it('returns the proper rate from utilization', async () => {
      expect(await gas.rate({ maker: 100, taker: 0 })).to.equal(utils.parseEther('-1.00').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 100, taker: 25 })).to.equal(utils.parseEther('-0.609375').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 100, taker: 50 })).to.equal(utils.parseEther('-0.21875').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 100, taker: 75 })).to.equal(utils.parseEther('0.171875').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 100, taker: 90 })).to.equal(utils.parseEther('0.625').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 100, taker: 100 })).to.equal(utils.parseEther('1.00').div(SECONDS_IN_YEAR))
      expect(await gas.rate({ maker: 100, taker: 125 })).to.equal(utils.parseEther('1.00').div(SECONDS_IN_YEAR))
    })
  })

  describe('#maintenance', async () => {
    it('returns correct maintenance', async () => {
      expect(await gas.maintenance()).to.equal(utils.parseEther('1.0'))
    })
  })

  describe('#fundingFee', async () => {
    it('returns correct fundingFee', async () => {
      expect(await gas.fundingFee()).to.equal(utils.parseEther('0.1'))
    })
  })

  describe('#makerFee', async () => {
    it('returns correct makerFee', async () => {
      expect(await gas.makerFee()).to.equal(utils.parseEther('0'))
    })
  })

  describe('#takerFee', async () => {
    it('returns correct takerFee', async () => {
      expect(await gas.takerFee()).to.equal(utils.parseEther('0'))
    })
  })

  describe('#makerLimit', async () => {
    it('returns correct makerLimit', async () => {
      expect(await gas.makerLimit()).to.equal(utils.parseEther('1000'))
    })
  })
})

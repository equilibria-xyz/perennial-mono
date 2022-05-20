import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import { IOracleProvider__factory, LeveragedEther, LeveragedEther__factory } from '../../../types/generated'

const { ethers } = HRE

const TIMESTAMP = 1636920000

describe('LeveragedEther', () => {
  let user: SignerWithAddress
  let oracle: MockContract
  let leveragedEther: LeveragedEther

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(user, IOracleProvider__factory.abi)
    leveragedEther = await new LeveragedEther__factory(user).deploy(
      oracle.address,
      utils.parseEther('1.00'),
      utils.parseEther('0.10'),
      utils.parseEther('0.0001'),
      utils.parseEther('0.0001'),
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
      expect(await leveragedEther.name()).to.equal('3x Ether')
    })
  })

  describe('#symbol', async () => {
    it('returns correct symbol', async () => {
      expect(await leveragedEther.symbol()).to.equal('ETH3x')
    })
  })

  describe('#oracle', async () => {
    it('returns correct oracle', async () => {
      expect(await leveragedEther.oracle()).to.equal(oracle.address)
    })
  })

  describe('#sync', async () => {
    it('calls sync on oracle', async () => {
      await oracle.mock.sync.withArgs().returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 1,
      })

      const result = await leveragedEther.connect(user).callStatic.sync()
      await leveragedEther.connect(user).sync()

      expect(result.price).to.equal(utils.parseEther('33'))
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

      const oracleVersion = await leveragedEther.atVersion(1)
      expect(oracleVersion.price).to.equal(utils.parseEther('33'))
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

      const oracleVersion = await leveragedEther.atVersion(2)
      expect(oracleVersion.price).to.equal(utils.parseEther('66'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(2)
    })
  })

  describe('#rate', async () => {
    const SECONDS_IN_YEAR = 60 * 60 * 24 * 365

    it('handles zero maker', async () => {
      expect(await leveragedEther.rate({ maker: 0, taker: 0 })).to.equal(utils.parseEther('1.00').div(SECONDS_IN_YEAR))
      expect(await leveragedEther.rate({ maker: 0, taker: 100 })).to.equal(
        utils.parseEther('1.00').div(SECONDS_IN_YEAR),
      )
    })

    it('returns the proper rate from utilization', async () => {
      expect(await leveragedEther.rate({ maker: 100, taker: 0 })).to.equal(
        utils.parseEther('-1.00').div(SECONDS_IN_YEAR),
      )
      expect(await leveragedEther.rate({ maker: 100, taker: 25 })).to.equal(
        utils.parseEther('-0.609375').div(SECONDS_IN_YEAR),
      )
      expect(await leveragedEther.rate({ maker: 100, taker: 50 })).to.equal(
        utils.parseEther('-0.21875').div(SECONDS_IN_YEAR),
      )
      expect(await leveragedEther.rate({ maker: 100, taker: 75 })).to.equal(
        utils.parseEther('0.171875').div(SECONDS_IN_YEAR),
      )
      expect(await leveragedEther.rate({ maker: 100, taker: 90 })).to.equal(
        utils.parseEther('0.625').div(SECONDS_IN_YEAR),
      )
      expect(await leveragedEther.rate({ maker: 100, taker: 100 })).to.equal(
        utils.parseEther('1.00').div(SECONDS_IN_YEAR),
      )
      expect(await leveragedEther.rate({ maker: 100, taker: 125 })).to.equal(
        utils.parseEther('1.00').div(SECONDS_IN_YEAR),
      )
    })
  })

  describe('#maintenance', async () => {
    it('returns correct maintenance', async () => {
      expect(await leveragedEther.maintenance()).to.equal(utils.parseEther('1.0'))
    })
  })

  describe('#fundingFee', async () => {
    it('returns correct fundingFee', async () => {
      expect(await leveragedEther.fundingFee()).to.equal(utils.parseEther('0.1'))
    })
  })

  describe('#makerFee', async () => {
    it('returns correct makerFee', async () => {
      expect(await leveragedEther.makerFee()).to.equal(utils.parseEther('0.0001'))
    })
  })

  describe('#takerFee', async () => {
    it('returns correct takerFee', async () => {
      expect(await leveragedEther.takerFee()).to.equal(utils.parseEther('0.0001'))
    })
  })

  describe('#makerLimit', async () => {
    it('returns correct makerLimit', async () => {
      expect(await leveragedEther.makerLimit()).to.equal(utils.parseEther('1000'))
    })
  })
})

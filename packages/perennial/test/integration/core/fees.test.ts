import { expect } from 'chai'
import 'hardhat'
import { utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from '../helpers/setupHelpers'
import { Big18Math, expectPositionEq } from '../../../../common/testutil/types'
import { Product } from '../../../types/generated'

const ONE_YEAR = 60 * 60 * 24 * 365

describe('Fees', () => {
  let instanceVars: InstanceVars
  let product: Product

  // Maker Fee is 1% of notional change
  const MAKER_FEE_RATE = utils.parseEther('0.01')
  // Taker Fee is 2% of notional change
  const TAKER_FEE_RATE = utils.parseEther('0.02')
  // Product and Protocol get 50% of position fees
  const POSITION_FEE_RATE = utils.parseEther('0.5')
  // Product and Protocol get 10% of accumulated funding
  const FUNDING_FEE_RATE = utils.parseEther('0.1')
  // Pin utilization curve at a rate of 1 for ease of calculation
  const FUNDING_RATE = utils.parseEther('1')
  // Split the fees 50/50 between protocol and product
  const PROTOCOL_FEE_RATE = utils.parseEther('0.5')

  const INITIAL_COLLATERAL = utils.parseEther('20000')
  const MAKER_POSITION = utils.parseEther('0.001')
  const TAKER_POSITION = utils.parseEther('0.001')

  beforeEach(async () => {
    instanceVars = await deployProtocol()
    product = await createProduct(instanceVars)

    await instanceVars.controller.updateProtocolFee(PROTOCOL_FEE_RATE)
    await product.updateMakerFee(MAKER_FEE_RATE)
    await product.updateTakerFee(TAKER_FEE_RATE)
    await product.updatePositionFee(POSITION_FEE_RATE)
    await product.updateFundingFee(FUNDING_FEE_RATE)
    await product.updateUtilizationCurve({
      minRate: FUNDING_RATE,
      maxRate: FUNDING_RATE,
      targetRate: FUNDING_RATE,
      targetUtilization: utils.parseEther('0.5'),
    })
  })

  context('brand new market', () => {
    beforeEach(async () => {
      const { user, userB, userC } = instanceVars
      await depositTo(instanceVars, user, product, INITIAL_COLLATERAL)
      await depositTo(instanceVars, userB, product, INITIAL_COLLATERAL)
      await depositTo(instanceVars, userC, product, INITIAL_COLLATERAL)

      await product.connect(user).openMake(MAKER_POSITION)
      await product.connect(userB).openMake(MAKER_POSITION.mul(2))
      await product.connect(userC).openTake(TAKER_POSITION)
    })

    it('debits fees from the users on position open', async () => {
      const { user, userB, userC, collateral } = instanceVars
      const currentVersion = await product.currentVersion()
      const MAKER_FEE = Big18Math.mul(Big18Math.mul(currentVersion.price, MAKER_FEE_RATE), MAKER_POSITION)
      const TAKER_FEE = Big18Math.mul(Big18Math.mul(currentVersion.price, TAKER_FEE_RATE), TAKER_POSITION)

      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        INITIAL_COLLATERAL.sub(MAKER_FEE),
      )
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        INITIAL_COLLATERAL.sub(MAKER_FEE.mul(2)),
      )
      expect(await collateral['collateral(address,address)'](userC.address, product.address)).to.equal(
        INITIAL_COLLATERAL.sub(TAKER_FEE),
      )
    })

    it('credits the protocol and product with the full fee amount', async () => {
      const { collateral, chainlink, treasuryA, treasuryB } = instanceVars
      const currentVersion = await product.currentVersion()
      const MAKER_FEE = Big18Math.mul(Big18Math.mul(currentVersion.price, MAKER_FEE_RATE), MAKER_POSITION.mul(3))
      const TAKER_FEE = Big18Math.mul(Big18Math.mul(currentVersion.price, TAKER_FEE_RATE), TAKER_POSITION)
      const TOTAL_FEE = MAKER_FEE.add(TAKER_FEE)

      await chainlink.next()
      await product.settle()

      // Protocol and Product treasuries each get 50% of the fees
      const protocolFees = await collateral.fees(treasuryA.address)
      const productFees = await collateral.fees(treasuryB.address)
      expect(TOTAL_FEE).to.be.equal(productFees.add(productFees))
      expect(protocolFees).to.equal(productFees)
    })
  })

  context('existing makers, first taker', () => {
    beforeEach(async () => {
      const { user, userB, userC, chainlink } = instanceVars
      await depositTo(instanceVars, user, product, INITIAL_COLLATERAL)
      await depositTo(instanceVars, userB, product, INITIAL_COLLATERAL)
      await depositTo(instanceVars, userC, product, INITIAL_COLLATERAL)

      await product.connect(user).openMake(MAKER_POSITION)
      await product.connect(userB).openMake(MAKER_POSITION.mul(2))

      await chainlink.next()
      await product.settle()

      await product.connect(userC).openTake(TAKER_POSITION)
    })

    it('credits the makers with the funding and taker position fee', async () => {
      const { collateral, chainlink, treasuryA, treasuryB } = instanceVars
      const aVersion = await product.currentVersion()

      await chainlink.next()
      const bVersion = await product.currentVersion()
      await chainlink.next()
      // Claim fees to make later calculations easier
      await collateral.connect(treasuryA).claimFee()
      await collateral.connect(treasuryB).claimFee()
      await product.settle()
      const cVersion = await product.currentVersion()

      expectPositionEq(await product.positionAtVersion(aVersion.version), { maker: MAKER_POSITION.mul(3), taker: 0 })
      expectPositionEq(await product.valueAtVersion(aVersion.version), {
        maker: 0,
        taker: 0,
      })

      expectPositionEq(await product.positionAtVersion(bVersion.version), {
        maker: MAKER_POSITION.mul(3),
        taker: TAKER_POSITION,
      })

      const A_TO_B_TAKER_FEE = Big18Math.mul(Big18Math.mul(aVersion.price, TAKER_FEE_RATE), TAKER_POSITION)
      // Taker Position Fee * (1 - protocol position fee)
      const B_MAKER_VALUE = Big18Math.div(A_TO_B_TAKER_FEE, MAKER_POSITION.mul(3)).div(2)
      expectPositionEq(await product.valueAtVersion(bVersion.version), {
        maker: B_MAKER_VALUE,
        taker: 0,
      })

      const B_TO_C_ELAPSED = cVersion.timestamp.sub(bVersion.timestamp)
      const B_TO_C_FUNDING = Big18Math.mul(
        Big18Math.mul(FUNDING_RATE.div(ONE_YEAR), B_TO_C_ELAPSED.mul(Big18Math.BASE)), // RateAccumulated
        Big18Math.mul(bVersion.price, TAKER_POSITION).abs(), // TakerNotional
      )
      const B_TO_C_FUNDING_FEE = Big18Math.mul(B_TO_C_FUNDING, FUNDING_FEE_RATE).abs()
      const B_TO_C_FUNDING_WITHOUT_FEE = B_TO_C_FUNDING.sub(B_TO_C_FUNDING_FEE)
      const B_TO_C_PNL = Big18Math.mul(cVersion.price.sub(bVersion.price), TAKER_POSITION)

      expectPositionEq(await product.positionAtVersion(cVersion.version), {
        maker: MAKER_POSITION.mul(3),
        taker: TAKER_POSITION,
      })

      // PnL + Funding
      const C_MAKER_VALUE = Big18Math.div(B_TO_C_PNL.mul(-1).add(B_TO_C_FUNDING_WITHOUT_FEE), MAKER_POSITION.mul(3))
      // PnL + (Funding - Funding Fee)
      const C_TAKER_VALUE = Big18Math.div(B_TO_C_PNL.sub(B_TO_C_FUNDING), TAKER_POSITION)
      expectPositionEq(await product.valueAtVersion(cVersion.version), {
        maker: C_MAKER_VALUE.add(B_MAKER_VALUE),
        taker: C_TAKER_VALUE,
      })

      // (A_TO_BE_TAKER_FEE * position fee + B_TO_C_FUNDING_FEE)
      const TOTAL_FEES = A_TO_B_TAKER_FEE.div(2).add(B_TO_C_FUNDING_FEE)
      // Check Protocol Fees = TOTAL_FEES * protocol fee
      expect(await collateral.fees(treasuryA.address)).to.equal(TOTAL_FEES.div(2))
      // Check Product Fees = TOTAL_FEES * (1 - protocol fee)
      expect(await collateral.fees(treasuryB.address)).to.equal(TOTAL_FEES.div(2))
    })
  })

  context('existing makers and takers', () => {
    beforeEach(async () => {
      const { user, userB, userC, chainlink } = instanceVars
      await depositTo(instanceVars, user, product, INITIAL_COLLATERAL)
      await depositTo(instanceVars, userB, product, INITIAL_COLLATERAL)
      await depositTo(instanceVars, userC, product, INITIAL_COLLATERAL)

      await product.connect(user).openMake(MAKER_POSITION)
      await product.connect(userC).openTake(TAKER_POSITION)

      await chainlink.next()
      await product.settle()

      await product.connect(userB).openMake(MAKER_POSITION.mul(2))
    })

    it('credits the takers with the maker position fee on open', async () => {
      const { collateral, chainlink, treasuryA, treasuryB } = instanceVars
      const aVersion = await product.currentVersion()

      await chainlink.next()
      const bVersion = await product.currentVersion()
      await chainlink.next()
      // Claim fees to make later calculations easier
      await collateral.connect(treasuryA).claimFee()
      await collateral.connect(treasuryB).claimFee()
      await product.settle()
      const cVersion = await product.currentVersion()

      expectPositionEq(await product.positionAtVersion(aVersion.version), {
        maker: MAKER_POSITION,
        taker: TAKER_POSITION,
      })
      expectPositionEq(await product.valueAtVersion(aVersion.version), {
        maker: 0,
        taker: 0,
      })

      expectPositionEq(await product.positionAtVersion(bVersion.version), {
        maker: MAKER_POSITION.mul(3),
        taker: TAKER_POSITION,
      })

      const A_TO_B_ELAPSED = bVersion.timestamp.sub(aVersion.timestamp)
      const A_TO_B_FUNDING = Big18Math.mul(
        Big18Math.mul(FUNDING_RATE.div(ONE_YEAR), A_TO_B_ELAPSED.mul(Big18Math.BASE)), // RateAccumulated
        Big18Math.mul(aVersion.price, TAKER_POSITION).abs(), // TakerNotional
      )
      const A_TO_B_FUNDING_FEE = Big18Math.mul(A_TO_B_FUNDING, FUNDING_FEE_RATE).abs()
      const A_TO_B_FUNDING_WITHOUT_FEE = A_TO_B_FUNDING.sub(A_TO_B_FUNDING_FEE)
      const A_TO_B_PNL = Big18Math.mul(bVersion.price.sub(aVersion.price), TAKER_POSITION)
      const A_TO_B_MAKER_FEE = Big18Math.mul(Big18Math.mul(aVersion.price, MAKER_FEE_RATE), MAKER_POSITION.mul(2))
      const B_MAKER_VALUE = Big18Math.div(A_TO_B_PNL.mul(-1).add(A_TO_B_FUNDING_WITHOUT_FEE), MAKER_POSITION)
      const B_TAKER_VALUE = Big18Math.div(A_TO_B_PNL.sub(A_TO_B_FUNDING).add(A_TO_B_MAKER_FEE.div(2)), TAKER_POSITION)

      expectPositionEq(await product.valueAtVersion(bVersion.version), {
        maker: B_MAKER_VALUE,
        taker: B_TAKER_VALUE,
      })

      const B_TO_C_ELAPSED = cVersion.timestamp.sub(bVersion.timestamp)
      const B_TO_C_FUNDING = Big18Math.mul(
        Big18Math.mul(FUNDING_RATE.div(ONE_YEAR), B_TO_C_ELAPSED.mul(Big18Math.BASE)), // RateAccumulated
        Big18Math.mul(bVersion.price, TAKER_POSITION).abs(), // TakerNotional
      )
      const B_TO_C_FUNDING_FEE = Big18Math.mul(B_TO_C_FUNDING, FUNDING_FEE_RATE).abs()
      const B_TO_C_FUNDING_WITHOUT_FEE = B_TO_C_FUNDING.sub(B_TO_C_FUNDING_FEE)
      const B_TO_C_PNL = Big18Math.mul(cVersion.price.sub(bVersion.price), TAKER_POSITION)

      expectPositionEq(await product.positionAtVersion(cVersion.version), {
        maker: MAKER_POSITION.mul(3),
        taker: TAKER_POSITION,
      })

      // PnL + Funding
      const C_MAKER_VALUE = Big18Math.div(B_TO_C_PNL.mul(-1).add(B_TO_C_FUNDING_WITHOUT_FEE), MAKER_POSITION.mul(3))
      // PnL + (Funding - Funding Fee)
      const C_TAKER_VALUE = Big18Math.div(B_TO_C_PNL.sub(B_TO_C_FUNDING), TAKER_POSITION)
      expectPositionEq(await product.valueAtVersion(cVersion.version), {
        maker: C_MAKER_VALUE.add(B_MAKER_VALUE),
        taker: C_TAKER_VALUE.add(B_TAKER_VALUE),
      })

      // (A_TO_BE_TAKER_FEE * position fee + A_TO_B_FUNDING_FEE + B_TO_C_FUNDING_FEE)
      const TOTAL_FEES = A_TO_B_MAKER_FEE.div(2).add(A_TO_B_FUNDING_FEE).add(B_TO_C_FUNDING_FEE)
      // Check Protocol Fees = TOTAL_FEES * protocol fee
      expect(await collateral.fees(treasuryA.address)).to.equal(TOTAL_FEES.div(2))
      // Check Product Fees = TOTAL_FEES * (1 - protocol fee)
      expect(await collateral.fees(treasuryB.address)).to.equal(TOTAL_FEES.div(2))
    })

    it('credits both sides on position closes', async () => {
      const { user, userC, collateral, chainlink, treasuryA, treasuryB } = instanceVars
      const aVersion = await product.currentVersion()
      await product.connect(user).closeMake(MAKER_POSITION)
      await product.connect(userC).closeTake(TAKER_POSITION)

      await chainlink.next()
      const bVersion = await product.currentVersion()
      await chainlink.next()
      // Claim fees to make later calculations easier
      await collateral.connect(treasuryA).claimFee()
      await collateral.connect(treasuryB).claimFee()
      await product.settle()
      const cVersion = await product.currentVersion()

      expectPositionEq(await product.positionAtVersion(aVersion.version), {
        maker: MAKER_POSITION,
        taker: TAKER_POSITION,
      })
      expectPositionEq(await product.valueAtVersion(aVersion.version), {
        maker: 0,
        taker: 0,
      })

      expectPositionEq(await product.positionAtVersion(bVersion.version), {
        maker: MAKER_POSITION.mul(2),
        taker: 0,
      })

      const A_TO_B_ELAPSED = bVersion.timestamp.sub(aVersion.timestamp)
      const A_TO_B_FUNDING = Big18Math.mul(
        Big18Math.mul(FUNDING_RATE.div(ONE_YEAR), A_TO_B_ELAPSED.mul(Big18Math.BASE)), // RateAccumulated
        Big18Math.mul(aVersion.price, TAKER_POSITION).abs(), // TakerNotional
      )
      const A_TO_B_FUNDING_FEE = Big18Math.mul(A_TO_B_FUNDING, FUNDING_FEE_RATE).abs()
      const A_TO_B_FUNDING_WITHOUT_FEE = A_TO_B_FUNDING.sub(A_TO_B_FUNDING_FEE)
      const A_TO_B_PNL = Big18Math.mul(bVersion.price.sub(aVersion.price), TAKER_POSITION)
      const A_TO_B_MAKER_FEE = Big18Math.mul(Big18Math.mul(aVersion.price, MAKER_FEE_RATE), MAKER_POSITION.mul(3))
      const A_TO_B_TAKER_FEE = Big18Math.mul(Big18Math.mul(aVersion.price, TAKER_FEE_RATE), TAKER_POSITION)
      const B_MAKER_VALUE = Big18Math.div(
        A_TO_B_PNL.mul(-1).add(A_TO_B_FUNDING_WITHOUT_FEE).add(A_TO_B_TAKER_FEE.div(2)),
        MAKER_POSITION,
      )
      const B_TAKER_VALUE = Big18Math.div(
        A_TO_B_PNL.sub(A_TO_B_FUNDING).add(A_TO_B_MAKER_FEE.sub(A_TO_B_MAKER_FEE.div(2))),
        TAKER_POSITION,
      )

      expectPositionEq(await product.valueAtVersion(bVersion.version), {
        maker: B_MAKER_VALUE,
        taker: B_TAKER_VALUE,
      })

      expectPositionEq(await product.positionAtVersion(cVersion.version), {
        maker: MAKER_POSITION.mul(2),
        taker: 0,
      })
      expectPositionEq(await product.valueAtVersion(cVersion.version), {
        maker: B_MAKER_VALUE,
        taker: B_TAKER_VALUE,
      })

      // ((A_TO_BE_TAKER_FEE + A_TO_BE_TAKER_FEE) * position fee + A_TO_B_FUNDING_FEE
      const TOTAL_FEES = A_TO_B_MAKER_FEE.add(A_TO_B_TAKER_FEE).div(2).add(A_TO_B_FUNDING_FEE)
      // Check Protocol Fees = TOTAL_FEES * protocol fee
      expect(await collateral.fees(treasuryA.address)).to.equal(TOTAL_FEES.div(2))
      // Check Product Fees = TOTAL_FEES * (1 - protocol fee)
      expect(await collateral.fees(treasuryB.address)).to.equal(TOTAL_FEES.div(2))
    })
  })
})

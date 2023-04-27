import { expect } from 'chai'
import 'hardhat'
import { utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, INITIAL_VERSION } from '../helpers/setupHelpers'
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
    })

    it('debits fees from the users on position open', async () => {
      const { user, userB, userC, collateral } = instanceVars

      const currentVersion = await product.currentVersion()
      const MAKER_FEE = Big18Math.mul(Big18Math.mul(currentVersion.price, MAKER_FEE_RATE), MAKER_POSITION)
      const TAKER_FEE = Big18Math.mul(Big18Math.mul(currentVersion.price, TAKER_FEE_RATE), TAKER_POSITION)

      await expect(product.connect(user).openMake(MAKER_POSITION))
        .to.emit(collateral, 'AccountSettle')
        .withArgs(product.address, user.address, MAKER_FEE.mul(-1), 0)
      await expect(product.connect(userB).openMake(MAKER_POSITION.mul(2)))
        .to.emit(collateral, 'AccountSettle')
        .withArgs(product.address, userB.address, MAKER_FEE.mul(-2), 0)
      await expect(product.connect(userC).openTake(TAKER_POSITION))
        .to.emit(collateral, 'AccountSettle')
        .withArgs(product.address, userC.address, TAKER_FEE.mul(-1), 0)

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
      const { user, userB, userC, collateral, chainlink, treasuryA, treasuryB } = instanceVars

      await product.connect(user).openMake(MAKER_POSITION)
      await product.connect(userB).openMake(MAKER_POSITION.mul(2))
      await product.connect(userC).openTake(TAKER_POSITION)

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
      const { user, userB, userC, collateral, chainlink, treasuryA, treasuryB } = instanceVars
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

      // PnL + (Funding - Funding Fee)
      const C_MAKER_VALUE = Big18Math.div(B_TO_C_PNL.mul(-1).add(B_TO_C_FUNDING_WITHOUT_FEE), MAKER_POSITION.mul(3))
      // PnL - Funding
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

      const INITIAL_MAKER_FEE = Big18Math.mul(
        Big18Math.mul((await product.atVersion(aVersion.version.sub(1))).price, MAKER_FEE_RATE),
        MAKER_POSITION,
      )

      await product.settleAccount(user.address)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(Big18Math.mul(B_MAKER_VALUE.add(C_MAKER_VALUE), MAKER_POSITION).sub(INITIAL_MAKER_FEE)),
      )

      await product.settleAccount(userB.address)
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(
          Big18Math.mul(B_MAKER_VALUE.add(C_MAKER_VALUE), MAKER_POSITION).sub(INITIAL_MAKER_FEE).mul(2),
        ),
      )

      await product.settleAccount(userC.address)
      expect(await collateral['collateral(address,address)'](userC.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(Big18Math.mul(C_TAKER_VALUE, TAKER_POSITION).sub(A_TO_B_TAKER_FEE)),
      )
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

    it('credits the existing makers with the maker position fee on open', async () => {
      const { user, userB, userC, collateral, chainlink, treasuryA, treasuryB } = instanceVars
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
      const B_MAKER_VALUE = Big18Math.div(
        A_TO_B_PNL.mul(-1).add(A_TO_B_FUNDING_WITHOUT_FEE).add(A_TO_B_MAKER_FEE.div(2)),
        MAKER_POSITION,
      )
      const B_TAKER_VALUE = Big18Math.div(A_TO_B_PNL.sub(A_TO_B_FUNDING), TAKER_POSITION)

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

      // PnL + (Funding - Funding Fee)
      const C_MAKER_VALUE = Big18Math.div(B_TO_C_PNL.mul(-1).add(B_TO_C_FUNDING_WITHOUT_FEE), MAKER_POSITION.mul(3))
      // PnL - Fundng
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

      const INITIAL_MAKER_FEE = Big18Math.mul(
        Big18Math.mul((await product.atVersion(aVersion.version.sub(1))).price, MAKER_FEE_RATE),
        MAKER_POSITION,
      )
      const INITIAL_TAKER_FEE = Big18Math.mul(
        Big18Math.mul((await product.atVersion(aVersion.version.sub(1))).price, TAKER_FEE_RATE),
        TAKER_POSITION,
      )

      await product.settleAccount(user.address)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(Big18Math.mul(B_MAKER_VALUE.add(C_MAKER_VALUE), MAKER_POSITION).sub(INITIAL_MAKER_FEE)),
      )

      await product.settleAccount(userB.address)
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(Big18Math.mul(C_MAKER_VALUE, MAKER_POSITION).mul(2).sub(A_TO_B_MAKER_FEE)),
      )

      await product.settleAccount(userC.address)
      expect(await collateral['collateral(address,address)'](userC.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(Big18Math.mul(B_TAKER_VALUE.add(C_TAKER_VALUE), TAKER_POSITION).sub(INITIAL_TAKER_FEE)),
      )
    })

    it('credits makers on position closes', async () => {
      const { user, userB, userC, collateral, chainlink, treasuryA, treasuryB } = instanceVars
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
        A_TO_B_PNL.mul(-1)
          .add(A_TO_B_FUNDING_WITHOUT_FEE)
          .add(A_TO_B_TAKER_FEE.div(2))
          .add(A_TO_B_MAKER_FEE.sub(A_TO_B_MAKER_FEE.div(2))),
        MAKER_POSITION,
      )
      const B_TAKER_VALUE = Big18Math.div(A_TO_B_PNL.sub(A_TO_B_FUNDING), TAKER_POSITION)

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

      const INITIAL_MAKER_FEE = Big18Math.mul(
        Big18Math.mul((await product.atVersion(aVersion.version.sub(1))).price, MAKER_FEE_RATE),
        MAKER_POSITION,
      )
      const INITIAL_TAKER_FEE = Big18Math.mul(
        Big18Math.mul((await product.atVersion(aVersion.version.sub(1))).price, TAKER_FEE_RATE),
        TAKER_POSITION,
      )

      await product.settleAccount(user.address)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(
          Big18Math.mul(B_MAKER_VALUE, MAKER_POSITION).sub(INITIAL_MAKER_FEE).sub(A_TO_B_MAKER_FEE.div(3)),
        ),
      )

      await product.settleAccount(userB.address)
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        INITIAL_COLLATERAL.sub(A_TO_B_MAKER_FEE.mul(2).div(3)),
      )

      await product.settleAccount(userC.address)
      expect(await collateral['collateral(address,address)'](userC.address, product.address)).to.equal(
        INITIAL_COLLATERAL.add(
          Big18Math.mul(B_TAKER_VALUE, TAKER_POSITION).sub(INITIAL_TAKER_FEE).sub(A_TO_B_TAKER_FEE),
        ),
      )
    })
  })

  describe('fee updates', () => {
    const NEW_MAKER_FEE_RATE = utils.parseEther('0.03')
    const NEW_TAKER_FEE_RATE = utils.parseEther('0.04')
    const NEW_POSITION_FEE_RATE = utils.parseEther('0.05')

    context('no pending pre positions', () => {
      it('updates the fees immediately', async () => {
        await expect(product.updateMakerFee(NEW_MAKER_FEE_RATE))
          .to.emit(product, 'MakerFeeUpdated')
          .withArgs(NEW_MAKER_FEE_RATE, INITIAL_VERSION)
        await expect(product.updateTakerFee(NEW_TAKER_FEE_RATE))
          .to.emit(product, 'TakerFeeUpdated')
          .withArgs(NEW_TAKER_FEE_RATE, INITIAL_VERSION)
        await expect(product.updatePositionFee(NEW_POSITION_FEE_RATE))
          .to.emit(product, 'PositionFeeUpdated')
          .withArgs(NEW_POSITION_FEE_RATE, INITIAL_VERSION)

        expect(await product.makerFee()).to.equal(NEW_MAKER_FEE_RATE)
        expect(await product.takerFee()).to.equal(NEW_TAKER_FEE_RATE)
        expect(await product.positionFee()).to.equal(NEW_POSITION_FEE_RATE)
      })
    })

    context('pending pre positions that can be settled', () => {
      beforeEach(async () => {
        const { user, userB, chainlink } = instanceVars
        await depositTo(instanceVars, user, product, INITIAL_COLLATERAL)
        await depositTo(instanceVars, userB, product, INITIAL_COLLATERAL)

        await product.connect(user).openMake(MAKER_POSITION)
        await product.connect(userB).openMake(TAKER_POSITION)

        await chainlink.next()
      })

      it('settles before updating maker fee', async () => {
        await expect(product.updateMakerFee(NEW_MAKER_FEE_RATE))
          .to.emit(product, 'MakerFeeUpdated')
          .withArgs(NEW_MAKER_FEE_RATE, INITIAL_VERSION + 1)
          .to.emit(product, 'Settle')
          .withArgs(INITIAL_VERSION + 1, INITIAL_VERSION + 1)

        expect(await product.makerFee()).to.equal(NEW_MAKER_FEE_RATE)
      })

      it('settles before updating taker fee', async () => {
        await expect(product.updateTakerFee(NEW_TAKER_FEE_RATE))
          .to.emit(product, 'TakerFeeUpdated')
          .withArgs(NEW_TAKER_FEE_RATE, INITIAL_VERSION + 1)
          .to.emit(product, 'Settle')
          .withArgs(INITIAL_VERSION + 1, INITIAL_VERSION + 1)

        expect(await product.takerFee()).to.equal(NEW_TAKER_FEE_RATE)
      })

      it('settles before updating position fee', async () => {
        await expect(product.updatePositionFee(NEW_POSITION_FEE_RATE))
          .to.emit(product, 'PositionFeeUpdated')
          .withArgs(NEW_POSITION_FEE_RATE, INITIAL_VERSION + 1)
          .to.emit(product, 'Settle')
          .withArgs(INITIAL_VERSION + 1, INITIAL_VERSION + 1)

        expect(await product.positionFee()).to.equal(NEW_POSITION_FEE_RATE)
      })
    })

    context("pending pre positions that can't be settled", async () => {
      beforeEach(async () => {
        const { user, userB } = instanceVars
        await depositTo(instanceVars, user, product, INITIAL_COLLATERAL)
        await depositTo(instanceVars, userB, product, INITIAL_COLLATERAL)

        await product.connect(user).openMake(MAKER_POSITION)
        await product.connect(userB).openMake(TAKER_POSITION)
      })

      it('puts the maker fee change in pending and updates on next settle', async () => {
        const { chainlink } = instanceVars

        await expect(product.updateMakerFee(NEW_MAKER_FEE_RATE))
          .to.emit(product, 'PendingMakerFeeUpdated')
          .withArgs(NEW_MAKER_FEE_RATE)

        expect(await product.makerFee()).to.equal(MAKER_FEE_RATE)
        expect((await product.pendingFeeUpdates()).pendingMakerFee).to.equal(NEW_MAKER_FEE_RATE)

        await chainlink.next()

        await expect(product.settle())
          .to.emit(product, 'MakerFeeUpdated')
          .withArgs(NEW_MAKER_FEE_RATE, INITIAL_VERSION + 1)

        expect(await product.makerFee()).to.equal(NEW_MAKER_FEE_RATE)
      })

      it('puts the taker fee change in pending and updates on next settle', async () => {
        const { chainlink } = instanceVars

        await expect(product.updateTakerFee(NEW_TAKER_FEE_RATE))
          .to.emit(product, 'PendingTakerFeeUpdated')
          .withArgs(NEW_TAKER_FEE_RATE)

        expect(await product.takerFee()).to.equal(TAKER_FEE_RATE)
        expect((await product.pendingFeeUpdates()).pendingTakerFee).to.equal(NEW_TAKER_FEE_RATE)

        await chainlink.next()

        await expect(product.settle())
          .to.emit(product, 'TakerFeeUpdated')
          .withArgs(NEW_TAKER_FEE_RATE, INITIAL_VERSION + 1)

        expect(await product.takerFee()).to.equal(NEW_TAKER_FEE_RATE)
      })

      it('puts the position fee change in pending and updates on next settle', async () => {
        const { chainlink } = instanceVars

        await expect(product.updatePositionFee(NEW_POSITION_FEE_RATE))
          .to.emit(product, 'PendingPositionFeeUpdated')
          .withArgs(NEW_POSITION_FEE_RATE)

        expect(await product.positionFee()).to.equal(POSITION_FEE_RATE)
        expect((await product.pendingFeeUpdates()).pendingPositionFee).to.equal(NEW_POSITION_FEE_RATE)

        await chainlink.next()

        await expect(product.settle())
          .to.emit(product, 'PositionFeeUpdated')
          .withArgs(NEW_POSITION_FEE_RATE, INITIAL_VERSION + 1)

        expect(await product.positionFee()).to.equal(NEW_POSITION_FEE_RATE)
      })

      it('batches multiple fee updates and updates all on next settle', async () => {
        const { chainlink } = instanceVars

        await expect(product.updateMakerFee(NEW_MAKER_FEE_RATE))
          .to.emit(product, 'PendingMakerFeeUpdated')
          .withArgs(NEW_MAKER_FEE_RATE)
        await expect(product.updateTakerFee(NEW_TAKER_FEE_RATE))
          .to.emit(product, 'PendingTakerFeeUpdated')
          .withArgs(NEW_TAKER_FEE_RATE)
        await expect(product.updatePositionFee(NEW_POSITION_FEE_RATE))
          .to.emit(product, 'PendingPositionFeeUpdated')
          .withArgs(NEW_POSITION_FEE_RATE)

        expect(await product.makerFee()).to.equal(MAKER_FEE_RATE)
        expect(await product.takerFee()).to.equal(TAKER_FEE_RATE)
        expect(await product.positionFee()).to.equal(POSITION_FEE_RATE)
        const pendingFees = await product.pendingFeeUpdates()
        expect(pendingFees.pendingMakerFee).to.equal(NEW_MAKER_FEE_RATE)
        expect(pendingFees.pendingTakerFee).to.equal(NEW_TAKER_FEE_RATE)
        expect(pendingFees.pendingPositionFee).to.equal(NEW_POSITION_FEE_RATE)

        await chainlink.next()

        await expect(product.settle())
          .to.emit(product, 'MakerFeeUpdated')
          .withArgs(NEW_MAKER_FEE_RATE, INITIAL_VERSION + 1)
          .to.emit(product, 'TakerFeeUpdated')
          .withArgs(NEW_TAKER_FEE_RATE, INITIAL_VERSION + 1)
          .to.emit(product, 'PositionFeeUpdated')
          .withArgs(NEW_POSITION_FEE_RATE, INITIAL_VERSION + 1)

        expect(await product.makerFee()).to.equal(NEW_MAKER_FEE_RATE)
        expect(await product.takerFee()).to.equal(NEW_TAKER_FEE_RATE)
        expect(await product.positionFee()).to.equal(NEW_POSITION_FEE_RATE)
      })
    })
  })
})

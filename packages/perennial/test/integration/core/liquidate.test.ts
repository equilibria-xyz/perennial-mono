import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from '../helpers/setupHelpers'

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('liquidates a user maintenance', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('500'))
    await product.connect(user).openMake(POSITION)

    expect(await collateral.liquidatable(user.address, product.address)).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.add(1000e8))
    await product.settle()

    await product.settleAccount(user.address)

    expect(await collateral.liquidatableNext(user.address, product.address)).to.be.true
    expect(await collateral.liquidatable(user.address, product.address)).to.be.true

    await expect(collateral.connect(userB).liquidate(user.address, product.address))
      .to.emit(collateral, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, '286895956958009478107')

    expect(await product.isLiquidating(user.address)).to.be.true

    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
      '213104043041990521893',
    )
    expect(await collateral['collateral(address)'](product.address)).to.equal('213104043041990521893')
    expect(await dsu.balanceOf(userB.address)).to.equal(
      utils.parseEther('20000').add(BigNumber.from('286895956958009478107')),
    ) // Original 20000 + fee

    await chainlink.next()
    await product.settleAccount(user.address)

    expect(await product.isLiquidating(user.address)).to.be.false
  })

  it('liquidates a user total collateral', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)

    expect(await collateral.liquidatable(user.address, product.address)).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await product.settle()

    await product.settleAccount(user.address)

    expect(await collateral.liquidatableNext(user.address, product.address)).to.be.true
    expect(await collateral.liquidatable(user.address, product.address)).to.be.true

    await expect(collateral.connect(userB).liquidate(user.address, product.address))
      .to.emit(collateral, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, utils.parseEther('1000'))

    expect(await product.isLiquidating(user.address)).to.be.true
    await expect(collateral.connect(userB).liquidate(user.address, product.address))
      .to.be.revertedWithCustomError(collateral, 'CollateralAccountLiquidatingError')
      .withArgs(user.address)
    await expect(
      collateral.connect(user).withdrawTo(user.address, product.address, constants.MaxUint256),
    ).to.be.revertedWithCustomError(collateral, 'CollateralInsufficientCollateralError')

    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
    expect(await collateral['collateral(address)'](product.address)).to.equal(0)
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('21000')) // Original 20000 + fee

    await chainlink.next()
    await product.settleAccount(user.address)

    expect(await product.isLiquidating(user.address)).to.be.false
    await expect(collateral.connect(user).withdrawTo(user.address, product.address, constants.MaxUint256)).to.not.be
      .reverted
  })

  it('liquidates a user with minCollateral', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, controller, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('500'))
    await product.connect(user).openMake(POSITION)

    expect(await collateral.liquidatable(user.address, product.address)).to.be.false

    // Settle the product with a new oracle version
    await controller.updateMinCollateral(utils.parseEther('1000'))
    await chainlink.nextWithPriceModification(price => price.add(1000e8))
    await product.settle()

    await product.settleAccount(user.address)

    expect(await collateral.liquidatableNext(user.address, product.address)).to.be.true
    expect(await collateral.liquidatable(user.address, product.address)).to.be.true

    await expect(collateral.connect(userB).liquidate(user.address, product.address))
      .to.emit(collateral, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, utils.parseEther('500'))

    expect(await product.isLiquidating(user.address)).to.be.true

    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
    expect(await collateral['collateral(address)'](product.address)).to.equal(0)
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('20500')) // Original 20000 + fee

    await chainlink.next()
    await product.settleAccount(user.address)

    expect(await product.isLiquidating(user.address)).to.be.false
  })

  it('creates and resolves a shortfall', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openTake(POSITION)

    // Settle the product with a new oracle version
    await chainlink.next()
    await product.settle()

    await chainlink.nextWithPriceModification(price => price.mul(2))
    await product.settle()
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
    expect(await collateral.shortfall(product.address)).to.equal('2463736825720737646856')

    const userBCollateral = await collateral['collateral(address,address)'](userB.address, product.address)
    await expect(
      collateral.connect(userB).withdrawTo(userB.address, product.address, userBCollateral),
    ).to.be.revertedWithPanic('0x11') // underflow

    await dsu.connect(userB).approve(collateral.address, constants.MaxUint256)
    await collateral.connect(userB).resolveShortfall(product.address, '2463736825720737646856')

    expect(await collateral.shortfall(product.address)).to.equal(0)
  })

  it('uses a socialization factor', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, userC, userD, collateral, chainlink, treasuryA, treasuryB } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userC, product, utils.parseEther('10000'))
    await depositTo(instanceVars, userD, product, utils.parseEther('10000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openMake(POSITION)
    await product.connect(userC).openTake(POSITION)
    await product.connect(userD).openTake(POSITION)

    expect(await collateral.liquidatable(user.address, product.address)).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    // Liquidate `user` which results in taker > maker
    const expectedLiquidationFee = BigNumber.from('682778989173237912428')
    await expect(collateral.connect(userB).liquidate(user.address, product.address))
      .to.emit(collateral, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, expectedLiquidationFee)

    await chainlink.next()
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)
    await product.settleAccount(userC.address)
    await product.settleAccount(userD.address)

    const currA = await collateral['collateral(address,address)'](user.address, product.address)
    const currB = await collateral['collateral(address,address)'](userB.address, product.address)
    const currC = await collateral['collateral(address,address)'](userC.address, product.address)
    const currD = await collateral['collateral(address,address)'](userD.address, product.address)
    const totalCurr = currA.add(currB).add(currC).add(currD)
    const feesCurr = (await collateral.fees(treasuryA.address)).add(await collateral.fees(treasuryB.address))

    await chainlink.next()
    await product.settleAccount(userB.address)
    await product.settleAccount(userC.address)
    await product.settleAccount(userD.address)

    const newA = await collateral['collateral(address,address)'](user.address, product.address)
    const newB = await collateral['collateral(address,address)'](userB.address, product.address)
    const newC = await collateral['collateral(address,address)'](userC.address, product.address)
    const newD = await collateral['collateral(address,address)'](userD.address, product.address)
    const totalNew = newA.add(newB).add(newC).add(newD)

    // Expect the loss from B to be socialized equally to C and D
    expect(currA).to.equal(newA)
    expect(currB.gt(newB)).to.equal(true)
    expect(currC.lt(newC)).to.equal(true)
    expect(currD.lt(newD)).to.equal(true)

    const feesNew = (await collateral.fees(treasuryA.address)).add(await collateral.fees(treasuryB.address))

    expect(totalCurr.add(feesCurr)).to.be.gte(totalNew.add(feesNew))
    expect(totalCurr.add(feesCurr)).to.be.closeTo(totalNew.add(feesNew), 1)

    // Expect the system to remain solvent
    expect(totalNew.add(feesNew)).to.equal(utils.parseEther('22000').sub(expectedLiquidationFee))
  }).timeout(120000)
})

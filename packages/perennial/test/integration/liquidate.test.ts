import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from './setupHelpers'

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('liquidates a user', async () => {
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

    expect(await collateral.connect(userB).liquidate(user.address, product.address))
      .to.emit(collateral, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, utils.parseEther('1000'))

    expect(await product.isLiquidating(user.address)).to.be.true

    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
    expect(await collateral['collateral(address)'](product.address)).to.equal(0)
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('21000')) // Original 20000 + fee

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
    expect(await collateral.shortfall(product.address)).to.equal('2463720317001203086618')

    const userBCollateral = await collateral['collateral(address,address)'](userB.address, product.address)
    await expect(
      collateral.connect(userB).withdrawTo(userB.address, product.address, userBCollateral),
    ).to.be.revertedWith('0x11') // underflow

    await dsu.connect(userB).approve(collateral.address, constants.MaxUint256)
    await collateral.connect(userB).resolveShortfall(product.address, '2463720317001203086618')

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
    await collateral.connect(userB).liquidate(user.address, product.address)

    await chainlink.next()
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)
    await product.settleAccount(userC.address)
    await product.settleAccount(userD.address)

    const currB = await collateral['collateral(address,address)'](userB.address, product.address)
    const currC = await collateral['collateral(address,address)'](userC.address, product.address)
    const currD = await collateral['collateral(address,address)'](userD.address, product.address)
    const totalCurr = currB.add(currC).add(currD)

    const feesCurr = (await collateral.fees(treasuryA.address)).add(await collateral.fees(treasuryB.address))

    await chainlink.next()
    await product.settleAccount(userB.address)
    await product.settleAccount(userC.address)
    await product.settleAccount(userD.address)

    const newB = await collateral['collateral(address,address)'](userB.address, product.address)
    const newC = await collateral['collateral(address,address)'](userC.address, product.address)
    const newD = await collateral['collateral(address,address)'](userD.address, product.address)
    const totalNew = newB.add(newC).add(newD)

    // Expect the loss from B to be socialized equally to C and D
    expect(currB.gt(newB)).to.equal(true)
    expect(currC.lt(newC)).to.equal(true)
    expect(currD.lt(newD)).to.equal(true)

    const feesNew = (await collateral.fees(treasuryA.address)).add(await collateral.fees(treasuryB.address))
    const feesDelta = feesNew.sub(feesCurr)

    expect(totalCurr.add(feesDelta)).to.be.gte(totalNew)
    expect(totalCurr.add(feesDelta)).to.be.closeTo(totalNew, 1)
  }).timeout(120000)
})

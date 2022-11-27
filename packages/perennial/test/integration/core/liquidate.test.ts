import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from '../helpers/setupHelpers'

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('liquidates a user', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).update(POSITION.mul(-1), 0)

    expect(await product.liquidatable(user.address)).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await product.settle(user.address)

    expect(await product.liquidatable(user.address)).to.be.true

    await expect(product.connect(userB).liquidate(user.address))
      .to.emit(product, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, utils.parseEther('1000'))

    expect(await product.liquidation(user.address)).to.be.true

    expect(await product['collateral(address)'](user.address)).to.equal(0)
    expect(await product['collateral()']()).to.equal(0)
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('21000')) // Original 20000 + fee

    await chainlink.next()
    await product.settle(user.address)

    expect(await product.liquidation(user.address)).to.be.false
  })

  it('creates and resolves a shortfall', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).update(POSITION.mul(-1), 0)
    await product.connect(userB).update(POSITION, 0)

    // Settle the product with a new oracle version
    await chainlink.next()
    await product.settle(constants.AddressZero)

    await chainlink.nextWithPriceModification(price => price.mul(2))
    await product.settle(user.address)
    await product.settle(userB.address)

    expect(await product['collateral(address)'](user.address)).to.equal(0)
    expect(await product.shortfall()).to.equal('2463736825720737646856')

    const userBCollateral = await product['collateral(address)'](userB.address)
    await expect(product.connect(userB).update(0, userBCollateral.mul(-1))).to.be.revertedWith('0x11') // underflow

    await dsu.connect(userB).approve(product.address, constants.MaxUint256)
    await product.connect(userB).resolveShortfall('2463736825720737646856')

    expect(await product.shortfall()).to.equal(0)
  })

  it('uses a socialization factor', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, userC, userD, chainlink, treasuryA, dsu } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userC, product, utils.parseEther('10000'))
    await depositTo(instanceVars, userD, product, utils.parseEther('10000'))
    await product.connect(user).update(POSITION.mul(-1), 0)
    await product.connect(userB).update(POSITION.mul(-1), 0)
    await product.connect(userC).update(POSITION, 0)
    await product.connect(userD).update(POSITION, 0)

    expect(await product.liquidatable(user.address)).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    // Liquidate `user` which results in taker > maker
    const expectedLiquidationFee = BigNumber.from('682778989173237912428')
    await expect(product.connect(userB).liquidate(user.address))
      .to.emit(product, 'Liquidation')
      .withArgs(user.address, product.address, userB.address, expectedLiquidationFee)

    await chainlink.next()
    await product.settle(user.address)
    await product.settle(userB.address)
    await product.settle(userC.address)
    await product.settle(userD.address)

    const currA = await product['collateral(address)'](user.address)
    const currB = await product['collateral(address)'](userB.address)
    const currC = await product['collateral(address)'](userC.address)
    const currD = await product['collateral(address)'](userD.address)
    const totalCurr = currA.add(currB).add(currC).add(currD)
    const feesCurr = (await product.protocolFees()).add(await product.productFees())

    await chainlink.next()
    await product.settle(userB.address)
    await product.settle(userC.address)
    await product.settle(userD.address)

    const newA = await product['collateral(address)'](user.address)
    const newB = await product['collateral(address)'](userB.address)
    const newC = await product['collateral(address)'](userC.address)
    const newD = await product['collateral(address)'](userD.address)
    const totalNew = newA.add(newB).add(newC).add(newD)

    // Expect the loss from B to be socialized equally to C and D
    expect(currA).to.equal(newA)
    expect(currB.gt(newB)).to.equal(true)
    expect(currC.lt(newC)).to.equal(true)
    expect(currD.lt(newD)).to.equal(true)

    const feesNew = (await product.protocolFees()).add(await product.productFees())

    expect(totalCurr.add(feesCurr)).to.be.gte(totalNew.add(feesNew))
    expect(totalCurr.add(feesCurr)).to.be.closeTo(totalNew.add(feesNew), 1)

    // Expect the system to remain solvent
    expect(totalNew.add(feesNew)).to.equal(utils.parseEther('22000').sub(expectedLiquidationFee))
  }).timeout(120000)
})

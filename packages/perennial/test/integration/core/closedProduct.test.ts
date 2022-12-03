import { expect } from 'chai'
import 'hardhat'
import { utils, constants } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from '../helpers/setupHelpers'
import { Product } from '../../../types/generated'

describe('Closed Product', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('closes the product', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).update(POSITION.mul(-1), 0)

    //TODO: uncomment when versioned params are added
    //expect(await product.closed()).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await product.settle(constants.AddressZero)

    await chainlink.next()
    const parameters = await product.parameter()
    parameters.closed = true
    await product.updateParameter(parameters)
    // await expect(product.updateClosed(true))
    //   .to.emit(product, 'PositionUpdated')
    //   .withArgs(true, 2474)
    //   .to.emit(product, 'Settle')
    //   .withArgs(2474, 2474)

    // expect(await product.closed()).to.be.true
  })

  describe('changes to system constraints', async () => {
    let product: Product
    const POSITION = utils.parseEther('0.0001')

    beforeEach(async () => {
      const { user, userB } = instanceVars

      product = await createProduct(instanceVars)
      await depositTo(instanceVars, user, product, utils.parseEther('1000'))
      await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
      await product.connect(user).update(POSITION.mul(-1), 0)
      await product.connect(userB).update(POSITION, 0)
      const parameters = await product.parameter()
      parameters.closed = true
      await product.updateParameter(parameters)
    })

    it('reverts on new open positions', async () => {
      await expect(product.connect(instanceVars.user).update(POSITION, 0)).to.be.revertedWith('ProductClosedError()')
    })

    it('allows insufficient liquidity for close positions', async () => {
      await expect(product.connect(instanceVars.user).update(POSITION, 0)).to.not.be.reverted
    })

    it('reverts on attempts to liquidate', async () => {
      const { user, chainlink, lens } = instanceVars
      await chainlink.nextWithPriceModification(price => price.mul(10))
      await product.settle(user.address)

      expect(await lens.callStatic.liquidatable(user.address, product.address)).to.be.true
      await expect(product.liquidate(user.address)).to.be.revertedWith('ProductClosedError()')
    })
  })

  it('zeroes PnL and fees', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).update(POSITION.mul(-1), 0)
    await product.connect(userB).update(POSITION, 0)

    await chainlink.next()
    await chainlink.next()
    const parameters = await product.parameter()
    parameters.closed = true
    await product.updateParameter(parameters)
    await product.settle(user.address)
    await product.settle(userB.address)

    const userCollateralBefore = (await product.accounts(user.address))._collateral
    const userBCollateralBefore = (await product.accounts(userB.address))._collateral
    const feesABefore = await product.protocolFees()
    const feesBBefore = await product.productFees()

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await product.settle(user.address)
    await product.settle(userB.address)

    expect((await product.accounts(user.address))._collateral).to.equal(userCollateralBefore)
    expect((await product.accounts(userB.address))._collateral).to.equal(userBCollateralBefore)
    expect(await product.productFees()).to.equal(feesABefore)
    expect(await product.productFees()).to.equal(feesBBefore)
  })

  it('handles closing during liquidations', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).update(POSITION.mul(-1), 0)
    await product.connect(userB).update(POSITION, 0)

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await expect(product.liquidate(user.address)).to.not.be.reverted
    expect(await product.liquidation(user.address)).to.be.true
    const parameters = await product.parameter()
    parameters.closed = true
    await product.updateParameter(parameters)
    await chainlink.next()

    await product.settle(user.address)
    await product.settle(userB.address)

    expect(await product.liquidation(user.address)).to.be.false
    const userCollateralBefore = (await product.accounts(user.address))._collateral
    const userBCollateralBefore = (await product.accounts(userB.address))._collateral
    const feesABefore = await product.protocolFees()
    const feesBBefore = await product.productFees()

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await product.settle(user.address)
    await product.settle(userB.address)

    expect((await product.accounts(user.address))._collateral).to.equal(userCollateralBefore)
    expect((await product.accounts(userB.address))._collateral).to.equal(userBCollateralBefore)
    expect(await product.protocolFees()).to.equal(feesABefore)
    expect(await product.productFees()).to.equal(feesBBefore)
  })
})

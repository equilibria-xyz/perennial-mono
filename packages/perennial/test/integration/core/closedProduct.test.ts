import { expect } from 'chai'
import 'hardhat'
import { utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, INITIAL_VERSION } from '../helpers/setupHelpers'
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
    await product.connect(user).openMake(POSITION)

    expect(await product.closed()).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await product.settle()

    await chainlink.next()
    await expect(product.updateClosed(true))
      .to.emit(product, 'ClosedUpdated')
      .withArgs(true, INITIAL_VERSION + 2)
      .to.emit(product, 'Settle')
      .withArgs(INITIAL_VERSION + 2, INITIAL_VERSION + 2)

    expect(await product.closed()).to.be.true
  })

  describe('changes to system constraints', async () => {
    let product: Product
    const POSITION = utils.parseEther('0.0001')

    beforeEach(async () => {
      const { user, userB } = instanceVars

      product = await createProduct(instanceVars)
      await depositTo(instanceVars, user, product, utils.parseEther('1000'))
      await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
      await product.connect(user).openMake(POSITION)
      await product.connect(userB).openTake(POSITION)
      await product.updateClosed(true)
    })

    it('reverts on new open positions', async () => {
      await expect(product.connect(instanceVars.user).openMake(POSITION)).to.be.revertedWithCustomError(
        product,
        'ProductClosedError',
      )
      await expect(product.connect(instanceVars.userB).openTake(POSITION)).to.be.revertedWithCustomError(
        product,
        'ProductClosedError',
      )
    })

    it('allows insufficient liquidity for close positions', async () => {
      await expect(product.connect(instanceVars.user).closeMake(POSITION)).to.not.be.reverted
    })

    it('reverts on attempts to liquidate', async () => {
      const { user, collateral, chainlink } = instanceVars
      await chainlink.nextWithPriceModification(price => price.mul(10))
      await product.settle()
      await product.settleAccount(user.address)

      expect(await collateral.liquidatable(user.address, product.address)).to.be.true
      await expect(collateral.liquidate(user.address, product.address)).to.be.revertedWithCustomError(
        product,
        'ProductClosedError',
      )
    })
  })

  it('zeroes PnL and fees', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, chainlink, treasuryA, treasuryB } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openTake(POSITION)

    await chainlink.next()
    await chainlink.next()
    await product.updateClosed(true)
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    const userCollateralBefore = await collateral['collateral(address,address)'](user.address, product.address)
    const userBCollateralBefore = await collateral['collateral(address,address)'](userB.address, product.address)
    const feesABefore = await collateral.fees(treasuryA.address)
    const feesBBefore = await collateral.fees(treasuryB.address)

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await collateral.shortfall(product.address)).to.equal(0)
    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
      userCollateralBefore,
    )
    expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
      userBCollateralBefore,
    )
    expect(await collateral.fees(treasuryA.address)).to.equal(feesABefore)
    expect(await collateral.fees(treasuryB.address)).to.equal(feesBBefore)
  })

  it('handles closing during liquidations', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, chainlink, treasuryA, treasuryB } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openTake(POSITION)

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await expect(collateral.liquidate(user.address, product.address)).to.not.be.reverted
    expect(await product.isLiquidating(user.address)).to.be.true
    await product.updateClosed(true)
    await chainlink.next()

    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await product.isLiquidating(user.address)).to.be.false
    const userCollateralBefore = await collateral['collateral(address,address)'](user.address, product.address)
    const userBCollateralBefore = await collateral['collateral(address,address)'](userB.address, product.address)
    const feesABefore = await collateral.fees(treasuryA.address)
    const feesBBefore = await collateral.fees(treasuryB.address)

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
      userCollateralBefore,
    )
    expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
      userBCollateralBefore,
    )
    expect(await collateral.fees(treasuryA.address)).to.equal(feesABefore)
    expect(await collateral.fees(treasuryB.address)).to.equal(feesBBefore)
  })
})

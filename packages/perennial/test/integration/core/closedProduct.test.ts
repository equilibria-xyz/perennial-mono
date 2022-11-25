import { expect } from 'chai'
import 'hardhat'
import { utils } from 'ethers'

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
    await product.connect(user).openMake(POSITION)

    //TODO: uncomment when versioned params are added
    //expect(await product.closed()).to.be.false

    // Settle the product with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await product.settle()

    await chainlink.next()
    const parameters = await product.parameter()
    await product.updateParameter(
      parameters.maintenance,
      parameters.fundingFee,
      parameters.makerFee,
      parameters.takerFee,
      parameters.positionFee,
      parameters.makerLimit,
      true,
    )
    // await expect(product.updateClosed(true))
    //   .to.emit(product, 'ClosedUpdated')
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
      await product.connect(user).openMake(POSITION)
      await product.connect(userB).openTake(POSITION)
      const parameters = await product.parameter()
      await product.updateParameter(
        parameters.maintenance,
        parameters.fundingFee,
        parameters.makerFee,
        parameters.takerFee,
        parameters.positionFee,
        parameters.makerLimit,
        true,
      )
    })

    it('reverts on new open positions', async () => {
      await expect(product.connect(instanceVars.user).openMake(POSITION)).to.be.revertedWith('ProductClosedError()')
      await expect(product.connect(instanceVars.userB).openTake(POSITION)).to.be.revertedWith('ProductClosedError()')
    })

    it('allows insufficient liquidity for close positions', async () => {
      await expect(product.connect(instanceVars.user).closeMake(POSITION)).to.not.be.reverted
    })

    it('reverts on attempts to liquidate', async () => {
      const { user, chainlink } = instanceVars
      await chainlink.nextWithPriceModification(price => price.mul(10))
      await product.settle()
      await product.settleAccount(user.address)

      expect(await product.liquidatable(user.address)).to.be.true
      await expect(product.liquidate(user.address)).to.be.revertedWith('ProductClosedError()')
    })
  })

  it('zeroes PnL and fees', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, chainlink, treasuryA, dsu } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openTake(POSITION)

    await chainlink.next()
    await chainlink.next()
    const parameters = await product.parameter()
    await product.updateParameter(
      parameters.maintenance,
      parameters.fundingFee,
      parameters.makerFee,
      parameters.takerFee,
      parameters.positionFee,
      parameters.makerLimit,
      true,
    )
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    const userCollateralBefore = await product['collateral(address)'](user.address)
    const userBCollateralBefore = await product['collateral(address)'](userB.address)
    const feesABefore = await dsu.balanceOf(treasuryA.address)
    const feesBBefore = await product.fees()

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await product.shortfall()).to.equal(0)
    expect(await product['collateral(address)'](user.address)).to.equal(userCollateralBefore)
    expect(await product['collateral(address)'](userB.address)).to.equal(userBCollateralBefore)
    expect(await product.fees()).to.equal(feesABefore)
    expect(await product.fees()).to.equal(feesBBefore)
  })

  it('handles closing during liquidations', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, chainlink, treasuryA, dsu } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openTake(POSITION)

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await expect(product.liquidate(user.address)).to.not.be.reverted
    expect(await product.isLiquidating(user.address)).to.be.true
    const parameters = await product.parameter()
    await product.updateParameter(
      parameters.maintenance,
      parameters.fundingFee,
      parameters.makerFee,
      parameters.takerFee,
      parameters.positionFee,
      parameters.makerLimit,
      true,
    )
    await chainlink.next()

    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await product.isLiquidating(user.address)).to.be.false
    const userCollateralBefore = await product['collateral(address)'](user.address)
    const userBCollateralBefore = await product['collateral(address)'](userB.address)
    const feesABefore = await dsu.balanceOf(treasuryA.address)
    const feesBBefore = await product.fees()

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await product.settleAccount(user.address)
    await product.settleAccount(userB.address)

    expect(await product['collateral(address)'](user.address)).to.equal(userCollateralBefore)
    expect(await product['collateral(address)'](userB.address)).to.equal(userBCollateralBefore)
    expect(await dsu.balanceOf(treasuryA.address)).to.equal(feesABefore)
    expect(await product.fees()).to.equal(feesBBefore)
  })
})

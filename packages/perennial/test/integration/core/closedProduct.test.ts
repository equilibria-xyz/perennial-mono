import { expect } from 'chai'
import 'hardhat'
import { utils, constants } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, depositTo } from '../helpers/setupHelpers'
import { Market } from '../../../types/generated'

describe('Closed Market', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('closes the market', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await market.connect(user).update(POSITION.mul(-1), 0)

    //TODO: uncomment when versioned params are added
    //expect(await market.closed()).to.be.false

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await market.settle(constants.AddressZero)

    await chainlink.next()
    const parameters = await market.parameter()
    parameters.closed = true
    await market.updateParameter(parameters)
    // await expect(market.updateClosed(true))
    //   .to.emit(market, 'Updated')
    //   .withArgs(true, 2474)

    // expect(await market.closed()).to.be.true
  })

  describe('changes to system constraints', async () => {
    let market: Market
    const POSITION = utils.parseEther('0.0001')

    beforeEach(async () => {
      const { user, userB } = instanceVars

      market = await createMarket(instanceVars)
      await depositTo(instanceVars, user, market, utils.parseEther('1000'))
      await depositTo(instanceVars, userB, market, utils.parseEther('1000'))
      await market.connect(user).update(POSITION.mul(-1), 0)
      await market.connect(userB).update(POSITION, 0)
      const parameters = await market.parameter()
      parameters.closed = true
      await market.updateParameter(parameters)
    })

    it('reverts on new open positions', async () => {
      await expect(market.connect(instanceVars.user).update(POSITION, 0)).to.be.revertedWith('MarketClosedError()')
    })

    it('allows insufficient liquidity for close positions', async () => {
      await expect(market.connect(instanceVars.user).update(POSITION, 0)).to.not.be.reverted
    })

    it('reverts on attempts to liquidate', async () => {
      const { user, chainlink, lens } = instanceVars
      await chainlink.nextWithPriceModification(price => price.mul(10))
      await market.settle(user.address)

      expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.true
      await expect(market.liquidate(user.address)).to.be.revertedWith('MarketClosedError()')
    })
  })

  it('zeroes PnL and fees', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, market, utils.parseEther('1000'))
    await market.connect(user).update(POSITION.mul(-1), 0)
    await market.connect(userB).update(POSITION, 0)

    await chainlink.next()
    await chainlink.next()
    const parameters = await market.parameter()
    parameters.closed = true
    await market.updateParameter(parameters)
    await market.settle(user.address)
    await market.settle(userB.address)

    const userCollateralBefore = (await market.accounts(user.address))._collateral
    const userBCollateralBefore = (await market.accounts(userB.address))._collateral
    const feesABefore = (await market.fee())._protocol
    const feesBBefore = (await market.fee())._market

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await market.settle(user.address)
    await market.settle(userB.address)

    expect((await market.accounts(user.address))._collateral).to.equal(userCollateralBefore)
    expect((await market.accounts(userB.address))._collateral).to.equal(userBCollateralBefore)
    expect((await market.fee())._protocol).to.equal(feesABefore)
    expect((await market.fee())._market).to.equal(feesBBefore)
  })

  it('handles closing during liquidations', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, market, utils.parseEther('1000'))
    await market.connect(user).update(POSITION.mul(-1), 0)
    await market.connect(userB).update(POSITION, 0)

    await chainlink.next()
    await chainlink.nextWithPriceModification(price => price.mul(2))
    await expect(market.liquidate(user.address)).to.not.be.reverted
    expect(await market.liquidation(user.address)).to.be.true
    const parameters = await market.parameter()
    parameters.closed = true
    await market.updateParameter(parameters)
    await chainlink.next()

    await market.settle(user.address)
    await market.settle(userB.address)

    expect(await market.liquidation(user.address)).to.be.false
    const userCollateralBefore = (await market.accounts(user.address))._collateral
    const userBCollateralBefore = (await market.accounts(userB.address))._collateral
    const feesABefore = (await market.fee())._protocol
    const feesBBefore = (await market.fee())._market

    await chainlink.nextWithPriceModification(price => price.mul(4))
    await chainlink.nextWithPriceModification(price => price.mul(4))
    await market.settle(user.address)
    await market.settle(userB.address)

    expect((await market.accounts(user.address))._collateral).to.equal(userCollateralBefore)
    expect((await market.accounts(userB.address))._collateral).to.equal(userBCollateralBefore)
    expect((await market.fee())._protocol).to.equal(feesABefore)
    expect((await market.fee())._market).to.equal(feesBBefore)
  })
})

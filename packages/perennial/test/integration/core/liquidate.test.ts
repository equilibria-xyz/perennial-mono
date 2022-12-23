import { expect } from 'chai'
import 'hardhat'
import { BigNumber, constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket } from '../helpers/setupHelpers'

describe('Liquidate', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('liquidates a user', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, dsu, chainlink, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await market.connect(user).update(POSITION.mul(-1), utils.parseEther('1000'))

    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.false

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(10))
    await market.settle(user.address)

    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.true

    await expect(market.connect(userB).liquidate(user.address))
      .to.emit(market, 'Liquidation')
      .withArgs(user.address, market.address, userB.address, utils.parseEther('1000'))

    expect(await market.liquidation(user.address)).to.be.true

    expect((await market.accounts(user.address))._collateral).to.equal(0)
    expect(await lens.callStatic['collateral(address)'](market.address)).to.equal(0)
    expect(await dsu.balanceOf(userB.address)).to.equal(utils.parseEther('21000')) // Original 20000 + fee

    await chainlink.next()
    await market.settle(user.address)

    expect(await market.liquidation(user.address)).to.be.false
  })

  it('creates and resolves a shortfall', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await market.connect(user).update(POSITION.mul(-1), utils.parseEther('1000'))
    await market.connect(userB).update(POSITION, utils.parseEther('1000'))

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    await chainlink.nextWithPriceModification(price => price.mul(2))
    await market.settle(user.address)
    await market.settle(userB.address)

    expect((await market.accounts(user.address))._collateral).to.equal(
      BigNumber.from('-2463736825720737646856').div(1e12),
    )

    const userBCollateral = (await market.accounts(userB.address))._collateral
    await expect(market.connect(userB).update(0, userBCollateral.mul(-1))).to.be.revertedWith('0x11') // underflow

    await dsu.connect(userB).approve(market.address, constants.MaxUint256)
    await market.connect(user).update(0, '2463736825720737646856') //TODO: from userB?

    expect((await market.accounts(user.address))._collateral).to.equal(0)
  })

  it('uses a socialization factor', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, userC, userD, chainlink, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await market.connect(user).update(POSITION.mul(-1), utils.parseEther('1000'))
    await market.connect(userB).update(POSITION.mul(-1), utils.parseEther('1000'))
    await market.connect(userC).update(POSITION, utils.parseEther('10000'))
    await market.connect(userD).update(POSITION, utils.parseEther('10000'))

    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.false

    // Settle the market with a new oracle version
    await chainlink.nextWithPriceModification(price => price.mul(2))

    // Liquidate `user` which results in taker > maker
    const expectedLiquidationFee = BigNumber.from('682778989173237912428')
    await expect(market.connect(userB).liquidate(user.address))
      .to.emit(market, 'Liquidation')
      .withArgs(user.address, market.address, userB.address, expectedLiquidationFee)

    await chainlink.next()
    await market.settle(user.address)
    await market.settle(userB.address)
    await market.settle(userC.address)
    await market.settle(userD.address)

    const currA = (await market.accounts(user.address))._collateral
    const currB = (await market.accounts(userB.address))._collateral
    const currC = (await market.accounts(userC.address))._collateral
    const currD = (await market.accounts(userD.address))._collateral
    const totalCurr = currA.add(currB).add(currC).add(currD)
    const feesCurr = (await market.fee())._protocol.add((await market.fee())._market)

    await chainlink.next()
    await market.settle(userB.address)
    await market.settle(userC.address)
    await market.settle(userD.address)

    const newA = (await market.accounts(user.address))._collateral
    const newB = (await market.accounts(userB.address))._collateral
    const newC = (await market.accounts(userC.address))._collateral
    const newD = (await market.accounts(userD.address))._collateral
    const totalNew = newA.add(newB).add(newC).add(newD)

    // Expect the loss from B to be socialized equally to C and D
    expect(currA).to.equal(newA)
    expect(currB.gt(newB)).to.equal(true)
    expect(currC.lt(newC)).to.equal(true)
    expect(currD.lt(newD)).to.equal(true)

    const feesNew = (await market.fee())._protocol.add((await market.fee())._market)

    expect(totalCurr.add(feesCurr)).to.be.gte(totalNew.add(feesNew))
    expect(totalCurr.add(feesCurr)).to.be.closeTo(totalNew.add(feesNew), 1)

    // Expect the system to remain solvent
    expect(totalNew.add(feesNew)).to.equal(utils.parseEther('22000').sub(expectedLiquidationFee))
  }).timeout(120000)
})

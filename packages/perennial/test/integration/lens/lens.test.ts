import { expect } from 'chai'
import 'hardhat'
import { utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, createIncentiveProgram } from '../helpers/setupHelpers'
import { time } from '../../../../common/testutil'
import { expectPositionEq, expectPrePositionEq } from '../../../../common/testutil/types'

const SECONDS_IN_YEAR = 60 * 60 * 24 * 365
const SECONDS_IN_DAY = 60 * 60 * 24

describe('Lens', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('returns correct lens values', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, collateral, chainlink, lens, controller, treasuryA, incentiveToken } = instanceVars

    expect(await lens.callStatic.controller()).to.equal(controller.address)
    // Setup fees
    controller.updateProtocolFee(utils.parseEther('0.25'))
    const product = await createProduct(instanceVars)
    await time.increase(-SECONDS_IN_YEAR)
    await createIncentiveProgram(instanceVars, product)
    await time.increase(SECONDS_IN_YEAR)

    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(POSITION)
    await product.connect(userB).openTake(POSITION)

    // Returns the product name
    expect(await lens.callStatic.name(product.address)).to.equal('Squeeth')
    // Returns the product symbol
    expect(await lens.callStatic.symbol(product.address)).to.equal('SQTH')
    // Returns collateral address
    expect(await lens.callStatic['collateral()']()).to.equal(collateral.address)

    // PrePositions should exist for user and userB
    let globalPre = await lens.callStatic['pre(address)'](product.address)
    let globalPosition = await lens.callStatic.globalPosition(product.address)
    expectPrePositionEq(globalPre, {
      openPosition: { maker: POSITION, taker: POSITION },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 2472,
    })
    expectPrePositionEq(globalPosition[0], globalPre)
    expectPositionEq(globalPosition[1], { maker: 0, taker: 0 })

    let userPre = await lens.callStatic['pre(address,address)'](user.address, product.address)
    let userPosition = await lens.callStatic.userPosition(user.address, product.address)
    expectPrePositionEq(userPre, {
      openPosition: { maker: POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 2472,
    })
    expectPrePositionEq(userPosition[0], userPre)
    expectPositionEq(userPosition[1], { maker: 0, taker: 0 })
    expect(await lens.callStatic.maintenanceRequired(user.address, product.address, 1000)).to.equal('3416489252')
    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal('341648925295826936134')
    expect(await lens.callStatic.price(product.address)).to.equal('11388297509860897871140900')
    expect(await lens.callStatic.priceAtVersion(product.address, 2472)).to.equal('11388297509860897871140900')
    expect(await lens.callStatic.rate(product.address)).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    expect(await lens.callStatic.dailyRate(product.address)).to.equal(
      utils.parseEther('5.00').div(SECONDS_IN_YEAR).mul(SECONDS_IN_DAY),
    )
    expectPositionEq(await lens.callStatic['openInterest(address,address)'](user.address, product.address), {
      maker: 0,
      taker: 0,
    })
    expectPositionEq(await lens.callStatic['openInterest(address,address)'](userB.address, product.address), {
      maker: 0,
      taker: 0,
    })
    expectPositionEq(await lens.callStatic['openInterest(address)'](product.address), {
      maker: 0,
      taker: 0,
    })

    await chainlink.next() // Update the price

    // PrePositions are zeroed out after price update and settlement
    globalPre = await lens.callStatic['pre(address)'](product.address)
    globalPosition = await lens.callStatic.globalPosition(product.address)
    expectPrePositionEq(globalPre, {
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 0,
    })
    expectPrePositionEq(globalPosition[0], globalPre)

    userPre = await lens.callStatic['pre(address,address)'](user.address, product.address)
    userPosition = await lens.callStatic.userPosition(user.address, product.address)
    expectPrePositionEq(userPre, {
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 0,
    })
    expectPrePositionEq(userPosition[0], userPre)

    // Pre -> Position
    expectPositionEq(await lens.callStatic['position(address)'](product.address), {
      maker: POSITION,
      taker: POSITION,
    })
    expectPositionEq(globalPosition[1], { maker: POSITION, taker: POSITION })
    expectPositionEq(await lens.callStatic['position(address,address)'](user.address, product.address), {
      maker: POSITION,
      taker: 0,
    })
    expectPositionEq(userPosition[1], { maker: POSITION, taker: 0 })
    expectPositionEq(await lens.callStatic['position(address,address)'](userB.address, product.address), {
      maker: 0,
      taker: POSITION,
    })

    // Maintenance required is updated
    expect(await lens.callStatic.maintenanceRequired(user.address, product.address, 1000)).to.equal('3413894945')
    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal('341389494586618956214')
    // Price is updated
    expect(await lens.callStatic.price(product.address)).to.equal('11379649819553965207140100')
    // Rate is updated
    expect(await lens.callStatic.rate(product.address)).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    expect(await lens.callStatic.dailyRate(product.address)).to.equal(
      utils.parseEther('5.00').div(SECONDS_IN_YEAR).mul(SECONDS_IN_DAY),
    )
    // OpenInterest is updated
    expectPositionEq(await lens.callStatic['openInterest(address,address)'](user.address, product.address), {
      maker: '1137964981955396520714', // Price * Position
      taker: 0,
    })
    expectPositionEq(await lens.callStatic['openInterest(address,address)'](userB.address, product.address), {
      maker: 0,
      taker: '1137964981955396520714',
    })
    expectPositionEq(await lens.callStatic['openInterest(address)'](product.address), {
      maker: '1137964981955396520714',
      taker: '1137964981955396520714',
    })

    // User starts off as not liquidatable before price update
    expect(await lens.callStatic.liquidatable(user.address, product.address)).to.be.false
    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal('341389494586618956214')

    // Fees before any positions are changed
    let fees = await lens.callStatic['fees(address)'](product.address)
    expect(fees.protocolFees).to.equal(0)
    expect(fees.productFees).to.equal(0)
    expect(await lens.callStatic['fees(address,address[])'](treasuryA.address, [product.address])).to.equal(0)

    // Big price change
    await chainlink.nextWithPriceModification(price => price.mul(2))

    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal('1380555115845583562915')
    expect(await lens.callStatic.liquidatable(user.address, product.address)).to.be.true

    // Liquidate the user
    await collateral.connect(userB).liquidate(user.address, product.address)

    expect(await lens.callStatic['collateral(address,address)'](user.address, product.address)).to.equal(0)
    expect(await lens.callStatic['collateral(address,address)'](userB.address, product.address)).to.equal(
      '4463720317001203086618',
    )
    expect(await lens.callStatic['collateral(address)'](product.address)).to.equal('1999983491280465439762')
    expect(await lens.callStatic.shortfall(product.address)).to.equal('2463736825720737646856')

    // Fees are updated
    fees = await lens.callStatic['fees(address)'](product.address)
    expect(fees.protocolFees).to.equal('4127179883640059')
    expect(fees.productFees).to.equal('12381539650920179')
    expect(await lens.callStatic['fees(address,address[])'](treasuryA.address, [product.address])).to.equal(
      '4127179883640059',
    )

    await chainlink.next()
    await product.settle()

    await chainlink.next()
    await product.settle()

    await product.connect(user).settleAccount(user.address)
    // Incentive Program Rewards are updated
    let incentiveRewards = await lens.callStatic['unclaimedIncentiveRewards(address,address)'](
      user.address,
      product.address,
    )
    expect(incentiveRewards.tokens[0].toLowerCase()).to.equal(incentiveToken.address.toLowerCase())
    expect(incentiveRewards.amounts[0]).to.equal('188786008230451956')
    incentiveRewards = await lens.callStatic['unclaimedIncentiveRewards(address,address,uint256[])'](
      user.address,
      product.address,
      [0],
    )
    expect(incentiveRewards.tokens[0].toLowerCase()).to.equal(incentiveToken.address.toLowerCase())
    expect(incentiveRewards.amounts[0]).to.equal('188786008230451956')
    const prices = await lens.callStatic.pricesAtVersions(product.address, [2472, 2475])
    expect(prices[0]).to.equal('11388297509860897871140900')
    expect(prices[1]).to.equal('11628475351618010828602500')
  })
})

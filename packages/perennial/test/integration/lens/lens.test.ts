import { expect } from 'chai'
import 'hardhat'
import { utils } from 'ethers'

import {
  InstanceVars,
  deployProtocol,
  createProduct,
  depositTo,
  createIncentiveProgram,
  INITIAL_VERSION,
} from '../helpers/setupHelpers'
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
    const { user, userB, collateral, chainlink, lens, controller, treasuryA, incentivizer, incentiveToken } =
      instanceVars

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

    // Protocol Snapshot
    const protocolSnapshot = await lens.callStatic['snapshot()']()
    expect(protocolSnapshot.collateral).to.equal(collateral.address)
    expect(protocolSnapshot.incentivizer).to.equal(incentivizer.address)
    expect(protocolSnapshot.protocolFee).to.equal(utils.parseEther('0.25'))
    expect(protocolSnapshot.liquidationFee).to.equal(utils.parseEther('0.50'))
    expect(protocolSnapshot.minCollateral).to.equal(utils.parseEther('500'))
    expect(protocolSnapshot.paused).to.be.false

    // Returns the product name
    const info = await lens.callStatic.info(product.address)
    expect(info.name).to.equal('Squeeth')
    // Returns the product symbol
    expect(info.symbol).to.equal('SQTH')
    // Returns collateral address
    expect(await lens.callStatic['collateral()']()).to.equal(collateral.address)

    // PrePositions should exist for user and userB
    let productSnapshot = (await lens.callStatic['snapshots(address[])']([product.address]))[0]
    let globalPre = productSnapshot.pre
    let globalPosition = productSnapshot.position
    expectPrePositionEq(globalPre, {
      openPosition: { maker: POSITION, taker: POSITION },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: INITIAL_VERSION,
    })
    expectPositionEq(globalPosition, { maker: 0, taker: 0 })
    expect(productSnapshot.latestVersion.price).to.equal('11388297509860897871140900')
    expect(productSnapshot.rate).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    expect(productSnapshot.dailyRate).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR).mul(SECONDS_IN_DAY))
    expectPositionEq(productSnapshot.openInterest, {
      maker: 0,
      taker: 0,
    })

    let userSnapshot = (await lens.callStatic['snapshots(address,address[])'](user.address, [product.address]))[0]
    let userPre = userSnapshot.pre
    let userPosition = userSnapshot.position
    expectPrePositionEq(userPre, {
      openPosition: { maker: POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: INITIAL_VERSION,
    })
    expectPositionEq(userPosition, { maker: 0, taker: 0 })
    expect(userSnapshot.maintenance).to.equal('341648925295826936134')
    expect(await lens.callStatic.maintenanceRequired(user.address, product.address, 1000)).to.equal('3416489252')

    expectPositionEq(userSnapshot.openInterest, {
      maker: 0,
      taker: 0,
    })
    expectPositionEq(await lens.callStatic['openInterest(address,address)'](userB.address, product.address), {
      maker: 0,
      taker: 0,
    })

    await chainlink.next() // Update the price

    // PrePositions are zeroed out after price update and settlement
    productSnapshot = await lens.callStatic['snapshot(address)'](product.address)
    globalPre = productSnapshot.pre
    globalPosition = productSnapshot.position
    expectPrePositionEq(globalPre, {
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 0,
    })

    userSnapshot = await lens.callStatic['snapshot(address,address)'](user.address, product.address)
    userPre = userSnapshot.pre
    userPosition = userSnapshot.position
    expectPrePositionEq(userPre, {
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 0,
    })

    // Pre -> Position
    expectPositionEq(globalPosition, {
      maker: POSITION,
      taker: POSITION,
    })
    expectPositionEq(userPosition, {
      maker: POSITION,
      taker: 0,
    })

    const userBPosition = await lens.callStatic.userPosition(userB.address, product.address)
    expectPrePositionEq(userBPosition[0], {
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
      oracleVersion: 0,
    })
    expectPositionEq(userBPosition[1], { maker: 0, taker: POSITION })

    // Maintenance required is updated
    expect(await lens.callStatic.maintenanceRequired(user.address, product.address, 1000)).to.equal('3413894945')
    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal('341389494586618956214')
    // Price is updated
    expect((await lens.callStatic.latestVersion(product.address)).price).to.equal('11379649819553965207140100')
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
    expect(await lens.callStatic['fees(address,address)'](treasuryA.address, product.address)).to.equal(0)

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
    expect(await lens.callStatic['fees(address,address)'](treasuryA.address, product.address)).to.equal(
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
    const prices = await lens.callStatic.atVersions(product.address, [INITIAL_VERSION, INITIAL_VERSION + 3])
    expect(prices[0].price).to.equal('11388297509860897871140900')
    expect(prices[1].price).to.equal('11628475351618010828602500')
  })
})

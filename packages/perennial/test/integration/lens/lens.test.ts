import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket } from '../helpers/setupHelpers'
import { expectPositionEq } from '../../../../common/testutil/types'
import { parse6decimal } from '../../../util/number'

const SECONDS_IN_YEAR = 60 * 60 * 24 * 365
const SECONDS_IN_DAY = 60 * 60 * 24

describe('Lens', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('returns correct lens values', async () => {
    const POSITION = parse6decimal('0.0001')
    const { user, userB, chainlink, lens, controller } = instanceVars

    expect(await lens.callStatic.factory()).to.equal(controller.address)
    // Setup fees
    const protocolParameter = await controller.parameter()
    protocolParameter.protocolFee = parse6decimal('0.25')
    controller.updateParameter(protocolParameter)
    const market = await createMarket(instanceVars)

    await market.connect(user).update(POSITION.mul(-1), parse6decimal('1000'))
    await market.connect(userB).update(POSITION, parse6decimal('1000'))

    // Returns the market name
    const info = await lens.callStatic.definition(market.address)
    expect(info.name).to.equal('Squeeth')
    // Returns the market symbol
    expect(info.symbol).to.equal('SQTH')

    // PrePositions should exist for user and userB
    let marketSnapshot = (await lens.callStatic['snapshots(address[])']([market.address]))[0]
    let globalPosition = marketSnapshot.position
    expectPositionEq(globalPosition, {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: POSITION,
    })
    expect(marketSnapshot.latestVersion.price).to.equal('11388297509860897871140900')
    expect(marketSnapshot.rate).to.equal(parse6decimal('5.00').div(SECONDS_IN_YEAR))
    expect(marketSnapshot.dailyRate).to.equal(parse6decimal('5.00').div(SECONDS_IN_YEAR).mul(SECONDS_IN_DAY))
    expect(marketSnapshot.openMakerInterest).to.equal(0)
    expect(marketSnapshot.openTakerInterest).to.equal(0)

    let userSnapshot = (await lens.callStatic['snapshots(address,address[])'](user.address, [market.address]))[0]
    expect(userSnapshot.next).to.equal(POSITION.mul(-1))
    expect(userSnapshot.position).to.equal(0)
    expect(userSnapshot.maintenance).to.equal('341648925295826936134')
    expect(await lens.callStatic.maintenanceRequired(user.address, market.address, 1000)).to.equal('3416489252')

    expect(userSnapshot.openInterest).to.equal(0)
    expect(await lens.callStatic['openInterest(address,address)'](userB.address, market.address)).to.equal(0)

    await chainlink.next() // Update the price

    // PrePositions are zeroed out after price update and settlement
    marketSnapshot = await lens.callStatic['snapshot(address)'](market.address)
    globalPosition = marketSnapshot.position

    userSnapshot = await lens.callStatic['snapshot(address,address)'](user.address, market.address)
    expect(userSnapshot.next).to.equal(0)

    // Pre -> Position
    expectPositionEq(globalPosition, {
      _maker: POSITION,
      _taker: POSITION,
      _makerNext: POSITION,
      _takerNext: POSITION,
    })
    expect(userSnapshot.position).to.equal(POSITION.mul(-1))

    const userBPosition = await lens.callStatic.userPosition(userB.address, market.address)
    expect(userBPosition[0]).to.equal(0)
    expect(userBPosition[1]).to.equal(POSITION)

    // Maintenance required is updated
    expect(await lens.callStatic.maintenanceRequired(user.address, market.address, 1000)).to.equal('3413894945')
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal('341389494586618956214')
    // Price is updated
    expect((await lens.callStatic.latestVersion(market.address)).price).to.equal('11379649819553965207140100')
    // Rate is updated
    expect(await lens.callStatic.rate(market.address)).to.equal(parse6decimal('5.00').div(SECONDS_IN_YEAR))
    expect(await lens.callStatic.dailyRate(market.address)).to.equal(
      parse6decimal('5.00').div(SECONDS_IN_YEAR).mul(SECONDS_IN_DAY),
    )
    // OpenInterest is updated
    expect(await lens.callStatic['openInterest(address,address)'](user.address, market.address)).to.equal(
      '-1137964981955396520714',
    ) // Price * Position
    expect(await lens.callStatic['openInterest(address,address)'](userB.address, market.address)).to.equal(
      '-1137964981955396520714',
    ) // Price * Position
    const [openMakerInterest, openTakerInterest] = await lens.callStatic['openInterest(address)'](market.address)
    expect(openMakerInterest).to.equal('1137964981955396520714')
    expect(openTakerInterest).to.equal('1137964981955396520714')

    // User starts off as not liquidatable before price update
    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.false
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal('341389494586618956214')

    // Fees before any positions are changed
    let fees = await lens.callStatic.fees(market.address)
    expect(fees._protocol).to.equal(0)
    expect(fees._market).to.equal(0)

    // Big price change
    await chainlink.nextWithPriceModification(price => price.mul(2))

    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal('1380555115845583562915')
    expect(await lens.callStatic.liquidatable(user.address, market.address)).to.be.true

    // Liquidate the user
    await market.connect(userB).liquidate(user.address)

    expect(await lens.callStatic['collateral(address,address)'](user.address, market.address)).to.equal(
      '-2463736825720737646856',
    )
    expect(await lens.callStatic['collateral(address,address)'](userB.address, market.address)).to.equal(
      '4463720317001203086618',
    )
    expect(await lens.callStatic['collateral(address)'](market.address)).to.equal('1999983491280465439762')

    // Fees are updated
    fees = await lens.callStatic.fees(market.address)
    expect(fees._protocol).to.equal('4127179883640059')
    expect(fees._market).to.equal('12381539650920179')

    await chainlink.next()
    await market.settle(constants.AddressZero)

    await chainlink.next()

    await market.connect(user).settle(user.address)
    const prices = await lens.callStatic.atVersions(market.address, [2472, 2475])
    expect(prices[0].price).to.equal('11388297509860897871140900')
    expect(prices[1].price).to.equal('11628475351618010828602500')
  })
})

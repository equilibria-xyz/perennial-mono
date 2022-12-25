import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, INITIAL_VERSION } from '../helpers/setupHelpers'
import { createPayoffDefinition, expectPositionEq } from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'
import { parse6decimal } from '../../../util/number'

describe.only('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('creates a market', async () => {
    const { owner, controller, treasuryB, contractPayoffProvider, chainlinkOracle, dsu, rewardToken } = instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: rewardToken.address,
    }
    const parameter = {
      maintenance: parse6decimal('0.3'),
      fundingFee: parse6decimal('0.1'),
      makerFee: 0,
      takerFee: 0,
      positionFee: 0,
      makerLimit: parse6decimal('1'),
      closed: true,
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      rewardRate: {
        maker: 0,
        taker: 0,
      },
      oracle: chainlinkOracle.address,
      payoff: {
        provider: contractPayoffProvider.address,
        short: false,
      },
    }
    const marketAddress = await controller.callStatic.createMarket(definition, parameter)
    await expect(controller.createMarket(definition, parameter)).to.emit(controller, 'MarketCreated')
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).acceptOwner()
    await market.connect(owner).updateTreasury(treasuryB.address)
  })

  it('opens a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(user).update(POSITION.mul(-1), COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.mul(-1), COLLATERAL)

    // Check user is in the correct state
    expect((await market.accounts(user.address)).position).to.equal(0)
    expect((await market.accounts(user.address)).next).to.equal(POSITION.mul(-1))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), {
      _maker: POSITION,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address)).position).to.equal(POSITION.mul(-1))
    expect((await market.accounts(user.address)).next).to.equal(POSITION.mul(-1))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('opens multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION.div(2).mul(-1), COLLATERAL)

    await expect(market.connect(user).update(POSITION.mul(-1), COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.mul(-1), COLLATERAL)

    // Check user is in the correct state
    expect((await market.accounts(user.address)).position).to.equal(0)
    expect((await market.accounts(user.address)).next).to.equal(POSITION.mul(-1))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), {
      _maker: POSITION,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address)).position).to.equal(POSITION.mul(-1))
    expect((await market.accounts(user.address)).next).to.equal(POSITION.mul(-1))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('closes a make position', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await expect(market.connect(user).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, 0, COLLATERAL)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address)).position).to.equal(0)
    expect((await market.accounts(user.address)).next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: 0,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('closes multiple make positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(user).update(POSITION.div(2).mul(-1), COLLATERAL)

    await expect(market.connect(user).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, 0, COLLATERAL)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address)).position).to.equal(0)
    expect((await market.accounts(user.address)).next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: 0,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('opens a take position', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await expect(market.connect(userB).update(POSITION_B, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, POSITION_B, COLLATERAL)

    // User State
    expect((await market.accounts(userB.address)).position).to.equal(0)
    expect((await market.accounts(userB.address)).next).to.equal(POSITION_B)
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: POSITION_B,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: POSITION,
      _taker: POSITION_B,
      _makerNext: POSITION,
      _takerNext: POSITION_B,
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address)).position).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).next).to.equal(POSITION_B)
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('opens multiple take positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION_B.div(2), COLLATERAL)

    await expect(market.connect(userB).update(POSITION_B, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, POSITION_B, COLLATERAL)

    // User State
    expect((await market.accounts(userB.address)).position).to.equal(0)
    expect((await market.accounts(userB.address)).next).to.equal(POSITION_B)
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: POSITION_B,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: POSITION,
      _taker: POSITION_B,
      _makerNext: POSITION,
      _takerNext: POSITION_B,
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address)).position).to.equal(POSITION_B)
    expect((await market.accounts(userB.address)).next).to.equal(POSITION_B)
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('closes a take position', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(userB).update(POSITION_B, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION_B, COLLATERAL)

    await expect(market.connect(userB).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, COLLATERAL)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address)).position).to.equal(0)
    expect((await market.accounts(userB.address)).next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('closes multiple take positions', async () => {
    const POSITION = parse6decimal('0.0001')
    const POSITION_B = parse6decimal('0.00001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, COLLATERAL.mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(1e12))

    await expect(market.connect(userB).update(POSITION_B, COLLATERAL)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(POSITION.mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION_B, COLLATERAL)
    await market.connect(userB).update(POSITION_B.div(2).mul(-1), COLLATERAL)

    await expect(market.connect(userB).update(0, COLLATERAL))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, 0, COLLATERAL)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address)).position).to.equal(0)
    expect((await market.accounts(userB.address)).next).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), {
      _maker: 0,
      _taker: 0,
      _makerNext: POSITION,
      _takerNext: 0,
    })
    const version = await market.versions(INITIAL_VERSION)
    expect(version._makerValue).to.equal(0)
    expect(version._takerValue).to.equal(0)
    expect(version._makerReward).to.equal(0)
    expect(version._takerReward).to.equal(0)
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const market = await createMarket(instanceVars)

    await market.settle(user.address)
    await market.settle(user.address)
  })

  it('disables actions when paused', async () => {
    const { controller, pauser, user } = instanceVars
    const market = await createMarket(instanceVars)

    await expect(controller.connect(pauser).updatePaused(true)).to.emit(controller, 'ParameterUpdated')
    await expect(market.update(0, parse6decimal('1000'))).to.be.revertedWith('PausedError()')
    await expect(market.liquidate(user.address)).to.be.revertedWith('PausedError()')
    await expect(market.update(parse6decimal('0.001'), 0)).to.be.revertedWith('PausedError()')
    await expect(market.settle(user.address)).to.be.revertedWith('PausedError()')
  })

  it('delayed update w/ collateral (gas)', async () => {
    const positionFeesOn = true
    const incentizesOn = true

    const POSITION = parse6decimal('0.0001')
    const COLLATERAL = parse6decimal('1000')
    const { user, userB, dsu, chainlink, chainlinkOracle, contractPayoffProvider } = instanceVars

    const parameter = {
      maintenance: parse6decimal('0.3'),
      fundingFee: parse6decimal('0.1'),
      makerFee: positionFeesOn ? parse6decimal('0.001') : 0,
      takerFee: positionFeesOn ? parse6decimal('0.001') : 0,
      positionFee: positionFeesOn ? parse6decimal('0.1') : 0,
      makerLimit: parse6decimal('1'),
      closed: false,
      utilizationCurve: {
        minRate: 0,
        maxRate: parse6decimal('5.00'),
        targetRate: parse6decimal('0.80'),
        targetUtilization: parse6decimal('0.80'),
      },
      rewardRate: {
        maker: incentizesOn ? parse6decimal('0.01') : 0,
        taker: incentizesOn ? parse6decimal('0.001') : 0,
      },
      oracle: chainlinkOracle.address,
      payoff: {
        provider: contractPayoffProvider.address,
        short: false,
      },
    }

    const market = await createMarket(instanceVars)
    await market.updateParameter(parameter)

    await dsu.connect(user).approve(market.address, COLLATERAL.mul(2).mul(1e12))
    await dsu.connect(userB).approve(market.address, COLLATERAL.mul(2).mul(1e12))

    await market.connect(user).update(POSITION.div(3).mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION.div(3), COLLATERAL)

    await chainlink.next()
    await chainlink.next()

    await market.connect(user).update(POSITION.div(2).mul(-1), COLLATERAL)
    await market.connect(userB).update(POSITION.div(2), COLLATERAL)

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(market.connect(user).update(POSITION.mul(-1), COLLATERAL.sub(1)))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 4, POSITION.mul(-1), COLLATERAL.sub(1))

    // Check user is in the correct state
    expect((await market.accounts(user.address)).position).to.equal(POSITION.div(2).mul(-1))
    expect((await market.accounts(user.address)).next).to.equal(POSITION.mul(-1))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 4)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 4)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(2),
      _taker: POSITION.div(2),
      _makerNext: POSITION,
      _takerNext: POSITION.div(2),
    })
    const version = await market.versions(INITIAL_VERSION + 4)
    expect(version._makerValue).to.equal('-357225572122')
    expect(version._takerValue).to.equal('367444018181')
    expect(version._makerReward).to.equal('60683636363')
    expect(version._takerReward).to.equal('606836363635')
  })
})

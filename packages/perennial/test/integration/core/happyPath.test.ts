import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createMarket, depositTo, INITIAL_VERSION } from '../helpers/setupHelpers'
import {
  createPayoffDefinition,
  expectAccumulatorEq,
  expectPositionEq,
  expectPrePositionEq,
} from '../../../../common/testutil/types'
import { Market__factory } from '../../../types/generated'

describe.only('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('creates a market', async () => {
    const { owner, user, controller, treasuryB, contractPayoffProvider, chainlinkOracle, dsu, rewardToken, lens } =
      instanceVars

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
      reward: rewardToken.address,
      payoffDefinition: createPayoffDefinition({ contractAddress: contractPayoffProvider.address }),
      oracle: chainlinkOracle.address,
    }
    const parameter = {
      maintenance: utils.parseEther('0.3'),
      fundingFee: utils.parseEther('0.1'),
      makerFee: 0,
      takerFee: 0,
      positionFee: 0,
      makerLimit: utils.parseEther('1'),
      closed: true,
      utilizationCurve: {
        minRate: 0,
        maxRate: utils.parseEther('5.00'),
        targetRate: utils.parseEther('0.80'),
        targetUtilization: utils.parseEther('0.80'),
      },
      rewardRate: {
        _maker: 0,
        _taker: 0,
      },
    }
    const marketAddress = await controller.callStatic.createMarket(definition, parameter)
    await expect(controller.createMarket(definition, parameter)).to.emit(controller, 'MarketCreated')
    const market = Market__factory.connect(marketAddress, owner)
    await market.connect(owner).acceptOwner()
    await market.connect(owner).updateTreasury(treasuryB.address)

    await dsu.connect(user).approve(marketAddress, utils.parseEther('1000'))
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))

    expect((await market.accounts(user.address))._collateral).to.equal(utils.parseEther('1000').div(1e12))
    expect(await lens.callStatic['collateral(address)'](market.address)).to.equal(utils.parseEther('1000'))
  })

  it('opens a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))

    await expect(market.connect(user).update(POSITION.mul(-1), 0))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.mul(-1), 0)

    // Check user is in the correct state
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._pre).to.equal(POSITION.mul(-1).div(1e9))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), { _maker: POSITION, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address))._position).to.equal(POSITION.mul(-1).div(1e9))
    expect((await market.accounts(user.address))._pre).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('opens multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))

    await market.connect(user).update(POSITION.div(2).mul(-1), 0)

    await expect(market.connect(user).update(POSITION.div(2).mul(-1), 0))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.div(2).mul(-1), 0)

    // Check user is in the correct state
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._pre).to.equal(POSITION.mul(-1).div(1e9))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })

    // Settle the market with a new oracle version
    await chainlink.next()
    await market.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await market.position(), { _maker: POSITION, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })

    // Settle user and check state
    await market.settle(user.address)
    expect((await market.accounts(user.address))._position).to.equal(POSITION.mul(-1).div(1e9))
    expect((await market.accounts(user.address))._pre).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('closes a make position', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await market.connect(user).update(OPEN_POSITION.mul(-1), 0)
    await market.connect(user).update(CLOSE_POSITION, 0)
    // await expect(market.connect(user).update(CLOSE_POSITION))
    //   .to.emit(market, 'Updated')
    //   .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION, 0)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._pre).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })
  })

  it('closes multiple make positions', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await market.connect(user).update(OPEN_POSITION.mul(-1), 0)
    await market.connect(user).update(CLOSE_POSITION.div(2), 0)

    await expect(market.connect(user).update(CLOSE_POSITION.div(2), 0))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION.div(2), 0)

    // User state
    expect(await lens.callStatic.maintenance(user.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, market.address)).to.equal(0)
    expect((await market.accounts(user.address))._position).to.equal(0)
    expect((await market.accounts(user.address))._pre).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })
  })

  it('opens a take position', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, market, utils.parseEther('1000'))

    await market.connect(user).update(MAKE_POSITION.mul(-1), 0)
    await expect(market.connect(userB).update(TAKE_POSITION, 0))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION, 0)

    // User State
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._pre).to.equal(TAKE_POSITION.div(1e9))
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: MAKE_POSITION,
      _taker: TAKE_POSITION,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: MAKE_POSITION,
      _taker: TAKE_POSITION,
    })
    expectPrePositionEq(await market.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address))._position).to.equal(TAKE_POSITION.div(1e9))
    expect((await market.accounts(userB.address))._pre).to.equal(0)
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('opens multiple take positions', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, market, utils.parseEther('1000'))

    await market.connect(user).update(MAKE_POSITION.mul(-1), 0)
    await market.connect(userB).update(TAKE_POSITION.div(2), 0)

    await expect(market.connect(userB).update(TAKE_POSITION.div(2), 0))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION.div(2), 0)

    // User State
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._pre).to.equal(TAKE_POSITION.div(1e9))
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: MAKE_POSITION,
      _taker: TAKE_POSITION,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await market.settle(constants.AddressZero)

    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: MAKE_POSITION,
      _taker: TAKE_POSITION,
    })
    expectPrePositionEq(await market.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    await market.settle(userB.address)
    expect((await market.accounts(userB.address))._position).to.equal(TAKE_POSITION.div(1e9))
    expect((await market.accounts(userB.address))._pre).to.equal(0)
    expect(await market.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('closes a take position', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, market, utils.parseEther('1000'))

    await expect(market.connect(userB).update(OPEN_TAKE_POSITION, 0)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(OPEN_MAKE_POSITION.mul(-1), 0)
    await market.connect(userB).update(OPEN_TAKE_POSITION, 0)

    await expect(market.connect(userB).update(CLOSE_TAKE_POSITION.mul(-1), 0))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.mul(-1), 0)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._pre).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: OPEN_MAKE_POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })
  })

  it('closes multiple take positions', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, lens } = instanceVars

    const market = await createMarket(instanceVars)
    await depositTo(instanceVars, user, market, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, market, utils.parseEther('1000'))

    await expect(market.connect(userB).update(OPEN_TAKE_POSITION, 0)).to.be.revertedWith(
      'MarketInsufficientLiquidityError()',
    )
    await market.connect(user).update(OPEN_MAKE_POSITION.mul(-1), 0)
    await market.connect(userB).update(OPEN_TAKE_POSITION, 0)
    await market.connect(userB).update(CLOSE_TAKE_POSITION.div(2).mul(-1), 0)

    await expect(market.connect(userB).update(CLOSE_TAKE_POSITION.div(2).mul(-1), 0))
      .to.emit(market, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.div(2).mul(-1), 0)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, market.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, market.address)).to.equal(0)
    expect((await market.accounts(userB.address))._position).to.equal(0)
    expect((await market.accounts(userB.address))._pre).to.equal(0)
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq(await market.position(), { _maker: 0, _taker: 0 })
    expectPrePositionEq(await market.pre(), {
      _maker: OPEN_MAKE_POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).value, { _maker: 0, _taker: 0 })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION)).reward, { _maker: 0, _taker: 0 })
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
    await expect(market.update(0, utils.parseEther('1000'))).to.be.revertedWith('PausedError()')
    await expect(market.liquidate(user.address)).to.be.revertedWith('PausedError()')
    await expect(market.update(utils.parseEther('0.001'), 0)).to.be.revertedWith('PausedError()')
    await expect(market.settle(user.address)).to.be.revertedWith('PausedError()')
  })

  it('delayed update w/ collateral (gas)', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, dsu, chainlink } = instanceVars

    const market = await createMarket(instanceVars)
    await dsu.connect(user).approve(market.address, utils.parseEther('1000'))
    await dsu.connect(userB).approve(market.address, utils.parseEther('1000'))
    await market.connect(user).update(POSITION.div(2).mul(-1), utils.parseEther('1000'))
    await market.connect(userB).update(POSITION.div(2), utils.parseEther('1000'))

    // Test with rewards on
    // await market.updateRewardRate({maker: utils.parseEther('0.01'), taker: utils.parseEther('0.001')})

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(market.connect(user).update(POSITION.div(2).mul(-1), utils.parseEther('-1')))
      .to.emit(market, 'Updated')
      .withArgs(user.address, INITIAL_VERSION + 2, POSITION.div(2).mul(-1), utils.parseEther('-1'))

    // Check user is in the correct state
    expect((await market.accounts(user.address))._position).to.equal(POSITION.div(2).mul(-1).div(1e9))
    expect((await market.accounts(user.address))._pre).to.equal(POSITION.div(2).mul(-1).div(1e9))
    expect(await market.latestVersions(user.address)).to.equal(INITIAL_VERSION + 2)

    // Check global state
    expect(await market.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await market.position(), {
      _maker: POSITION.div(2),
      _taker: POSITION.div(2),
    })
    expectPrePositionEq(await market.pre(), {
      _maker: POSITION.div(2),
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION + 2)).value, {
      _maker: '-123490361067779693900000',
      _taker: '123325273872433235780000',
    })
    expectAccumulatorEq((await market.versions(INITIAL_VERSION + 2)).reward, {
      _maker: 0,
      _taker: 0,
    })
  })
})

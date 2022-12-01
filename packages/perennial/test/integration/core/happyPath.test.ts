import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, INITIAL_VERSION } from '../helpers/setupHelpers'
import { createPayoffDefinition, expectPositionEq, expectPrePositionEq } from '../../../../common/testutil/types'
import { Product__factory } from '../../../types/generated'

describe.only('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('creates a product', async () => {
    const { owner, user, controller, treasuryB, contractPayoffProvider, chainlinkOracle, dsu, lens } = instanceVars

    await expect(controller.createCoordinator()).to.emit(controller, 'CoordinatorCreated').withArgs(1, owner.address)
    await expect(controller.updateCoordinatorTreasury(1, treasuryB.address))
      .to.emit(controller, 'CoordinatorTreasuryUpdated')
      .withArgs(1, treasuryB.address)

    const definition = {
      name: 'Squeeth',
      symbol: 'SQTH',
      token: dsu.address,
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
    }
    const productAddress = await controller.callStatic.createProduct(1, definition, parameter)
    await expect(controller.createProduct(1, definition, parameter)).to.emit(controller, 'ProductCreated')
    const product = Product__factory.connect(productAddress, owner)

    await dsu.connect(user).approve(productAddress, utils.parseEther('1000'))
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    expect((await product.accounts(user.address)).collateral).to.equal(utils.parseEther('1000'))
    expect(await lens.callStatic['collateral(address)'](product.address)).to.equal(utils.parseEther('1000'))
  })

  it('opens a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    await expect(product.connect(user).update(POSITION.mul(-1), 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.mul(-1))

    // Check user is in the correct state
    expect((await product.accounts(user.address))._position).to.equal(0)
    expect((await product.accounts(user.address))._pre).to.equal(POSITION.mul(-1))
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })

    // Settle the product with a new oracle version
    await chainlink.next()
    await product.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq((await product.versions(INITIAL_VERSION + 1))._position, { maker: POSITION, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })

    // Settle user and check state
    await product.settle(user.address)
    expect((await product.accounts(user.address))._position).to.equal(POSITION.mul(-1))
    expect((await product.accounts(user.address))._pre).to.equal(0)
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('opens multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    await product.connect(user).update(POSITION.div(2).mul(-1), 0)

    await expect(product.connect(user).update(POSITION.div(2).mul(-1), 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.div(2).mul(-1))

    // Check user is in the correct state
    expect((await product.accounts(user.address))._position).to.equal(0)
    expect((await product.accounts(user.address))._pre).to.equal(POSITION.mul(-1))
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })

    // Settle the product with a new oracle version
    await chainlink.next()
    await product.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq((await product.versions(INITIAL_VERSION + 1))._position, { maker: POSITION, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })

    // Settle user and check state
    await product.settle(user.address)
    expect((await product.accounts(user.address))._position).to.equal(POSITION.mul(-1))
    expect((await product.accounts(user.address))._pre).to.equal(0)
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('closes a make position', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, lens } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).update(OPEN_POSITION.mul(-1), 0)
    await product.connect(user).update(CLOSE_POSITION, 0)
    // await expect(product.connect(user).update(CLOSE_POSITION))
    //   .to.emit(product, 'PositionUpdated')
    //   .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION)

    // User state
    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, product.address)).to.equal(0)
    expect((await product.accounts(user.address))._position).to.equal(0)
    expect((await product.accounts(user.address))._pre).to.equal(0)
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })
  })

  it('closes multiple make positions', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, lens } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).update(OPEN_POSITION.mul(-1), 0)
    await product.connect(user).update(CLOSE_POSITION.div(2), 0)

    await expect(product.connect(user).update(CLOSE_POSITION.div(2), 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION.div(2))

    // User state
    expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(user.address, product.address)).to.equal(0)
    expect((await product.accounts(user.address))._position).to.equal(0)
    expect((await product.accounts(user.address))._pre).to.equal(0)
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })
  })

  it('opens a take position', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await product.connect(user).update(MAKE_POSITION.mul(-1), 0)
    await expect(product.connect(userB).update(TAKE_POSITION, 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION)

    // User State
    expect((await product.accounts(userB.address))._position).to.equal(0)
    expect((await product.accounts(userB.address))._pre).to.equal(TAKE_POSITION)
    expect(await product.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: MAKE_POSITION,
      _taker: TAKE_POSITION,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await product.settle(constants.AddressZero)

    expect(await product.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq((await product.versions(INITIAL_VERSION + 2))._position, {
      maker: MAKE_POSITION,
      taker: TAKE_POSITION,
    })
    expectPrePositionEq(await product.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    await product.settle(userB.address)
    expect((await product.accounts(userB.address))._position).to.equal(TAKE_POSITION)
    expect((await product.accounts(userB.address))._pre).to.equal(0)
    expect(await product.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('opens multiple take positions', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await product.connect(user).update(MAKE_POSITION.mul(-1), 0)
    await product.connect(userB).update(TAKE_POSITION.div(2), 0)

    await expect(product.connect(userB).update(TAKE_POSITION.div(2), 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION.div(2))

    // User State
    expect((await product.accounts(userB.address))._position).to.equal(0)
    expect((await product.accounts(userB.address))._pre).to.equal(TAKE_POSITION)
    expect(await product.latestVersions(userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: MAKE_POSITION,
      _taker: TAKE_POSITION,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await product.settle(constants.AddressZero)

    expect(await product.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq((await product.versions(INITIAL_VERSION + 2))._position, {
      maker: MAKE_POSITION,
      taker: TAKE_POSITION,
    })
    expectPrePositionEq(await product.pre(), {
      _maker: 0,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    await product.settle(userB.address)
    expect((await product.accounts(userB.address))._position).to.equal(TAKE_POSITION)
    expect((await product.accounts(userB.address))._pre).to.equal(0)
    expect(await product.latestVersions(userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('closes a take position', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, lens } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).update(OPEN_TAKE_POSITION, 0)).to.be.revertedWith(
      'ProductInsufficientLiquidityError()',
    )
    await product.connect(user).update(OPEN_MAKE_POSITION.mul(-1), 0)
    await product.connect(userB).update(OPEN_TAKE_POSITION, 0)

    await expect(product.connect(userB).update(CLOSE_TAKE_POSITION.mul(-1), 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.mul(-1))

    // User State
    expect(await lens.callStatic.maintenance(userB.address, product.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, product.address)).to.equal(0)
    expect((await product.accounts(userB.address))._position).to.equal(0)
    expect((await product.accounts(userB.address))._pre).to.equal(0)
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: OPEN_MAKE_POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })
  })

  it('closes multiple take positions', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, lens } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).update(OPEN_TAKE_POSITION, 0)).to.be.revertedWith(
      'ProductInsufficientLiquidityError()',
    )
    await product.connect(user).update(OPEN_MAKE_POSITION.mul(-1), 0)
    await product.connect(userB).update(OPEN_TAKE_POSITION, 0)
    await product.connect(userB).update(CLOSE_TAKE_POSITION.div(2).mul(-1), 0)

    await expect(product.connect(userB).update(CLOSE_TAKE_POSITION.div(2).mul(-1), 0))
      .to.emit(product, 'PositionUpdated')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.div(2).mul(-1))

    // User State
    expect(await lens.callStatic.maintenance(userB.address, product.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, product.address)).to.equal(0)
    expect((await product.accounts(userB.address))._position).to.equal(0)
    expect((await product.accounts(userB.address))._pre).to.equal(0)
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION)
    expectPositionEq((await product.versions(INITIAL_VERSION))._position, { maker: 0, taker: 0 })
    expectPrePositionEq(await product.pre(), {
      _maker: OPEN_MAKE_POSITION,
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION))._value, { maker: 0, taker: 0 })
    expectPositionEq((await product.versions(INITIAL_VERSION))._share, { maker: 0, taker: 0 })
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const product = await createProduct(instanceVars)

    await product.settle(user.address)
    await product.settle(user.address)
  })

  it('disables actions when paused', async () => {
    const { controller, pauser, user } = instanceVars
    const product = await createProduct(instanceVars)

    await expect(controller.connect(pauser).updatePaused(true)).to.emit(controller, 'PausedUpdated').withArgs(true)
    await expect(product.update(0, utils.parseEther('1000'))).to.be.revertedWith('PausedError()')
    await expect(product.liquidate(user.address)).to.be.revertedWith('PausedError()')
    await expect(product.update(utils.parseEther('0.001'), 0)).to.be.revertedWith('PausedError()')
    await expect(product.settle(user.address)).to.be.revertedWith('PausedError()')
  })

  it('delayed update w/ collateral (gas)', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, userB, dsu, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await dsu.connect(user).approve(product.address, utils.parseEther('1000'))
    await dsu.connect(userB).approve(product.address, utils.parseEther('1000'))
    await product.connect(user).update(POSITION.div(2).mul(-1), utils.parseEther('1000'))
    await product.connect(userB).update(POSITION.div(2), utils.parseEther('1000'))

    // Ensure a->b->c
    await chainlink.next()
    await chainlink.next()

    await expect(product.connect(user).update(POSITION.div(2).mul(-1), utils.parseEther('-1')))
      .to.emit(product, 'PositionUpdated')
      .withArgs(user.address, INITIAL_VERSION + 2, POSITION.div(2).mul(-1))

    // Check user is in the correct state
    expect((await product.accounts(user.address))._position).to.equal(POSITION.div(2).mul(-1))
    expect((await product.accounts(user.address))._pre).to.equal(POSITION.div(2).mul(-1))
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION + 2)

    // Check global state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq((await product.versions(INITIAL_VERSION + 2))._position, {
      maker: POSITION.div(2),
      taker: POSITION.div(2),
    })
    expectPrePositionEq(await product.pre(), {
      _maker: POSITION.div(2),
      _taker: 0,
      _makerFee: 0,
      _takerFee: 0,
    })
    expectPositionEq((await product.versions(INITIAL_VERSION + 2))._value, {
      maker: '-29840671308188362617140000',
      taker: '-32892462923465729382860000',
    })
    expectPositionEq((await product.versions(INITIAL_VERSION + 2))._share, {
      maker: '18300000000000000000000000',
      taker: '18300000000000000000000000',
    })
  })
})

import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, INITIAL_VERSION } from '../helpers/setupHelpers'
import {
  Big18Math,
  createPayoffDefinition,
  expectPositionEq,
  expectPrePositionEq,
} from '../../../../common/testutil/types'
import { Product } from '../../../types/generated'

describe('Happy Path', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('initializes', async () => {
    const { collateral, controller, dsu, multiInvoker } = instanceVars

    expect((await collateral.controller()).toUpperCase()).to.equal(controller.address.toUpperCase())
    expect((await collateral.token()).toUpperCase()).to.equal(dsu.address.toUpperCase())
    expect((await controller.multiInvoker()).toUpperCase()).to.equal(multiInvoker.address.toUpperCase())
  })

  it('reverts if already initialized', async () => {
    const { collateral, controller } = instanceVars

    await expect(collateral.initialize(controller.address))
      .to.be.revertedWithCustomError(collateral, 'UInitializableAlreadyInitializedError')
      .withArgs(1)
  })

  it('creates a product', async () => {
    const { owner, user, controller, collateral, treasuryB, contractPayoffProvider, chainlinkOracle, dsu } =
      instanceVars

    await expect(controller.createCoordinator()).to.emit(controller, 'CoordinatorCreated').withArgs(1, owner.address)
    await expect(controller.updateCoordinatorTreasury(1, treasuryB.address))
      .to.emit(controller, 'CoordinatorTreasuryUpdated')
      .withArgs(1, treasuryB.address)

    const productInfo = {
      name: 'Squeeth',
      symbol: 'SQTH',
      payoffDefinition: createPayoffDefinition({ contractAddress: contractPayoffProvider.address }),
      oracle: chainlinkOracle.address,
      maintenance: utils.parseEther('0.3'),
      fundingFee: utils.parseEther('0.1'),
      makerFee: 0,
      takerFee: 0,
      positionFee: 0,
      makerLimit: utils.parseEther('1'),
      utilizationCurve: {
        minRate: 0,
        maxRate: utils.parseEther('5.00'),
        targetRate: utils.parseEther('0.80'),
        targetUtilization: utils.parseEther('0.80'),
      },
    }
    const productAddress = await controller.callStatic.createProduct(1, productInfo)
    await expect(controller.createProduct(1, productInfo)).to.emit(controller, 'ProductCreated')

    await dsu.connect(user).approve(collateral.address, utils.parseEther('1000'))
    await collateral.connect(user).depositTo(user.address, productAddress, utils.parseEther('1000'))

    expect(await collateral['collateral(address)'](productAddress)).to.equal(utils.parseEther('1000'))
    expect(await collateral.shortfall(productAddress)).to.equal(0)
  })

  it('opens a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    await expect(product.connect(user).openMake(POSITION))
      .to.emit(product, 'MakeOpened')
      .withArgs(user.address, INITIAL_VERSION, POSITION)

    // Check user is in the correct state
    expect(await product.isClosed(user.address)).to.equal(false)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // Settle the product with a new oracle version
    await chainlink.next()
    await product.settle()

    // Check global post-settlement state
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 1), { maker: POSITION, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })

    // Settle user and check state
    await product.settleAccount(user.address)
    expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('opens multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    await product.connect(user).openMake(POSITION.div(2))

    await expect(product.connect(user).openMake(POSITION.div(2)))
      .to.emit(product, 'MakeOpened')
      .withArgs(user.address, INITIAL_VERSION, POSITION.div(2))

    // Check user is in the correct state
    expect(await product.isClosed(user.address)).to.equal(false)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Check global state
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // Settle the product with a new oracle version
    await chainlink.next()
    await product.settle()

    // Check global post-settlement state
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 1), { maker: POSITION, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })

    // Settle user and check state
    await product.settleAccount(user.address)
    expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION + 1)
  })

  it('closes a make position', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).openMake(OPEN_POSITION)

    await expect(product.connect(user).closeMake(CLOSE_POSITION))
      .to.emit(product, 'MakeClosed')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION)

    // User state
    expect(await product.isClosed(user.address)).to.equal(false)
    expect(await product['maintenance(address)'](user.address)).to.equal(0)
    expect(await product.maintenanceNext(user.address)).to.equal(0)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_POSITION, taker: 0 },
      closePosition: { maker: CLOSE_POSITION, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_POSITION, taker: 0 },
      closePosition: { maker: CLOSE_POSITION, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // Settle account to move pre -> pos
    await chainlink.next()
    await product.connect(user).settleAccount(user.address)

    expect(await product.isClosed(user.address)).to.equal(true)
    expect(await product['maintenance(address)'](user.address)).to.equal(0)
    expect(await product.maintenanceNext(user.address)).to.equal(0)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION + 1)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
  })

  it('closes multiple make positions', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).openMake(OPEN_POSITION)
    await product.connect(user).closeMake(CLOSE_POSITION.div(2))

    await expect(product.connect(user).closeMake(CLOSE_POSITION.div(2)))
      .to.emit(product, 'MakeClosed')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION.div(2))

    // User state
    expect(await product.isClosed(user.address)).to.equal(false)
    expect(await product['maintenance(address)'](user.address)).to.equal(0)
    expect(await product.maintenanceNext(user.address)).to.equal(0)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_POSITION, taker: 0 },
      closePosition: { maker: CLOSE_POSITION, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_POSITION, taker: 0 },
      closePosition: { maker: CLOSE_POSITION, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // Settle account to move pre -> pos
    await chainlink.next()
    await product.connect(user).settleAccount(user.address)

    expect(await product.isClosed(user.address)).to.equal(true)
    expect(await product['maintenance(address)'](user.address)).to.equal(0)
    expect(await product.maintenanceNext(user.address)).to.equal(0)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION + 1)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
  })

  it('opens a take position', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await product.connect(user).openMake(MAKE_POSITION)
    await expect(product.connect(userB).openTake(TAKE_POSITION))
      .to.emit(product, 'TakeOpened')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION)

    // User State
    expect(await product.isClosed(userB.address)).to.equal(false)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: TAKE_POSITION },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: MAKE_POSITION, taker: TAKE_POSITION },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await product.settle()

    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 2), {
      maker: MAKE_POSITION,
      taker: TAKE_POSITION,
    })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    await product.settleAccount(userB.address)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: TAKE_POSITION })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('opens multiple take positions', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await product.connect(user).openMake(MAKE_POSITION)
    await product.connect(userB).openTake(TAKE_POSITION.div(2))

    await expect(product.connect(userB).openTake(TAKE_POSITION.div(2)))
      .to.emit(product, 'TakeOpened')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION.div(2))

    // User State
    expect(await product.isClosed(userB.address)).to.equal(false)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: TAKE_POSITION },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: MAKE_POSITION, taker: TAKE_POSITION },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // One round
    await chainlink.next()
    await chainlinkOracle.sync()

    // Another round
    await chainlink.next()
    await product.settle()

    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 2)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 2), {
      maker: MAKE_POSITION,
      taker: TAKE_POSITION,
    })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    await product.settleAccount(userB.address)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: TAKE_POSITION })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION + 2)
  })

  it('closes a take position', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).openTake(OPEN_TAKE_POSITION))
      .to.be.revertedWithCustomError(product, 'ProductInsufficientLiquidityError')
      .withArgs(constants.MaxUint256)
    await product.connect(user).openMake(OPEN_MAKE_POSITION)
    await product.connect(userB).openTake(OPEN_TAKE_POSITION)

    await expect(product.connect(userB).closeTake(CLOSE_TAKE_POSITION))
      .to.emit(product, 'TakeClosed')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION)

    // User State
    expect(await product.isClosed(userB.address)).to.equal(false)
    expect(await product['maintenance(address)'](userB.address)).to.equal(0)
    expect(await product.maintenanceNext(userB.address)).to.equal(0)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: OPEN_TAKE_POSITION },
      closePosition: { maker: 0, taker: CLOSE_TAKE_POSITION },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_MAKE_POSITION, taker: OPEN_TAKE_POSITION },
      closePosition: { maker: 0, taker: CLOSE_TAKE_POSITION },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // Settle account to move pre -> pos
    await chainlink.next()
    await product.connect(userB).settleAccount(userB.address)

    expect(await product.isClosed(userB.address)).to.equal(true)
    expect(await product['maintenance(address)'](userB.address)).to.equal(0)
    expect(await product.maintenanceNext(userB.address)).to.equal(0)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION + 1)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 1), { maker: OPEN_MAKE_POSITION, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
  })

  it('closes multiple take positions', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink } = instanceVars

    const product = await createProduct(instanceVars)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).openTake(OPEN_TAKE_POSITION))
      .to.be.revertedWithCustomError(product, 'ProductInsufficientLiquidityError')
      .withArgs(constants.MaxUint256)
    await product.connect(user).openMake(OPEN_MAKE_POSITION)
    await product.connect(userB).openTake(OPEN_TAKE_POSITION)
    await product.connect(userB).closeTake(CLOSE_TAKE_POSITION.div(2))

    await expect(product.connect(userB).closeTake(CLOSE_TAKE_POSITION.div(2)))
      .to.emit(product, 'TakeClosed')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.div(2))

    // User State
    expect(await product.isClosed(userB.address)).to.equal(false)
    expect(await product['maintenance(address)'](userB.address)).to.equal(0)
    expect(await product.maintenanceNext(userB.address)).to.equal(0)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: OPEN_TAKE_POSITION },
      closePosition: { maker: 0, taker: CLOSE_TAKE_POSITION },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_MAKE_POSITION, taker: OPEN_TAKE_POSITION },
      closePosition: { maker: 0, taker: CLOSE_TAKE_POSITION },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })

    // Settle account to move pre -> pos
    await chainlink.next()
    await product.connect(userB).settleAccount(userB.address)

    expect(await product.isClosed(userB.address)).to.equal(true)
    expect(await product['maintenance(address)'](userB.address)).to.equal(0)
    expect(await product.maintenanceNext(userB.address)).to.equal(0)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION + 1)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION + 1)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION + 1), { maker: OPEN_MAKE_POSITION, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: 0,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION + 1), { maker: 0, taker: 0 })
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const product = await createProduct(instanceVars)

    await product.settle()
    await product.settle()
    await product.settleAccount(user.address)
    await product.settleAccount(user.address)
  })

  it('disables actions when paused', async () => {
    const { controller, collateral, pauser, user } = instanceVars
    const product = await createProduct(instanceVars)

    await expect(controller.connect(pauser).updatePaused(true)).to.emit(controller, 'PausedUpdated').withArgs(true)
    await expect(
      collateral.depositTo(user.address, product.address, utils.parseEther('1000')),
    ).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(
      collateral.withdrawTo(user.address, product.address, utils.parseEther('1000')),
    ).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(collateral.liquidate(user.address, product.address)).to.be.revertedWithCustomError(
      collateral,
      'PausedError',
    )

    await expect(product.openMake(utils.parseEther('0.001'))).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(product.closeMake(utils.parseEther('0.001'))).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(product.openTake(utils.parseEther('0.001'))).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(product.closeTake(utils.parseEther('0.001'))).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(product.settle()).to.be.revertedWithCustomError(collateral, 'PausedError')
    await expect(product.settleAccount(user.address)).to.be.revertedWithCustomError(collateral, 'PausedError')
  })

  it('reverts when calling "*For" methods from non-account and non-multiinvoker', async () => {
    const { incentivizer, collateral, user, userB } = instanceVars
    const product = await createProduct(instanceVars)

    await expect(product.connect(user).openMakeFor(userB.address, utils.parseEther('0.001')))
      .to.be.revertedWithCustomError(product, 'NotAccountOrMultiInvokerError')
      .withArgs(userB.address, user.address)
    await expect(product.connect(user).openTakeFor(userB.address, utils.parseEther('0.001')))
      .to.be.revertedWithCustomError(product, 'NotAccountOrMultiInvokerError')
      .withArgs(userB.address, user.address)
    await expect(
      collateral.connect(user).withdrawFrom(userB.address, user.address, product.address, utils.parseEther('100')),
    )
      .to.be.revertedWithCustomError(collateral, 'NotAccountOrMultiInvokerError')
      .withArgs(userB.address, user.address)
    await expect(incentivizer.connect(user).claimFor(userB.address, product.address, [1]))
      .to.be.revertedWithCustomError(incentivizer, 'NotAccountOrMultiInvokerError')
      .withArgs(userB.address, user.address)
  })

  describe('maker and taker fee calculations', () => {
    let product: Product
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const DEPOSIT_AMOUNT = utils.parseEther('10000')
    const MAKER_FEE = utils.parseEther('0.25')
    const TAKER_FEE = utils.parseEther('0.5')

    beforeEach(async () => {
      const { user, userB, controller } = instanceVars
      // Send all fees to product
      await controller.updateProtocolFee(0)
      product = await createProduct(instanceVars)
      // Force a 0.0 rate to make tests simpler
      await product.updateUtilizationCurve({
        minRate: 0,
        maxRate: 0,
        targetRate: 0,
        targetUtilization: utils.parseEther('1'),
      })
      await product.updateMakerFee(MAKER_FEE)
      await product.updateTakerFee(TAKER_FEE)
      await product.updatePositionFee(utils.parseEther('1')) // Send all fees to protocol/product
      await depositTo(instanceVars, user, product, DEPOSIT_AMOUNT)
      await depositTo(instanceVars, userB, product, DEPOSIT_AMOUNT)
    })

    it('charges the fees for each position change', async () => {
      const { user, userB, chainlink, collateral, treasuryB } = instanceVars

      await product.connect(user).openMake(MAKE_POSITION.div(2))
      await product.connect(userB).openTake(TAKE_POSITION.div(2))
      await product.connect(userB).closeTake(TAKE_POSITION.div(2))
      await product.connect(user).closeMake(MAKE_POSITION.div(2))

      // Fees are charged on the version the open/close action happened, rather than the settlement version
      const currentVersion = await product.currentVersion()

      await chainlink.next()
      await product.settle()

      const totalMakerFees = Big18Math.mul(Big18Math.mul(currentVersion.price, MAKE_POSITION.div(2)), MAKER_FEE).add(
        Big18Math.mul(Big18Math.mul(currentVersion.price, MAKE_POSITION.div(2)), MAKER_FEE),
      )
      const totalTakerFees = Big18Math.mul(Big18Math.mul(currentVersion.price, TAKE_POSITION.div(2)), TAKER_FEE).add(
        Big18Math.mul(Big18Math.mul(currentVersion.price, TAKE_POSITION.div(2)), TAKER_FEE),
      )
      const totalFees = totalMakerFees.add(totalTakerFees)

      // 0.0001 * productPrice * 0.5 + 0.00001 * productPrice * 0.5
      expect((await collateral.fees(treasuryB.address)).sub(totalFees)).to.be.within(0, 1)

      await product.settleAccount(user.address)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        DEPOSIT_AMOUNT.sub(totalMakerFees),
      )
      await product.settleAccount(userB.address)
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        DEPOSIT_AMOUNT.sub(totalTakerFees),
      )
    })

    it('charges global fees when global position nets out (maker)', async () => {
      const { user, userB, chainlink, collateral, treasuryB } = instanceVars

      // Don't charge a fee here
      await product.updateMakerFee(0)
      await product.connect(user).openMake(MAKE_POSITION)

      await chainlink.next()
      await product.settle()
      await product.settleAccount(user.address)

      // Charge a maker fee for future position changes
      await product.updateMakerFee(utils.parseEther('0.5'))
      await product.connect(user).closeMake(MAKE_POSITION)
      await product.connect(userB).openMake(MAKE_POSITION)
      const currentVersion = await product.currentVersion()

      await chainlink.next()
      await product.settle()

      const makerFeePerPosition = Big18Math.mul(currentVersion.price, MAKE_POSITION).div(2)
      const totalFees = makerFeePerPosition.mul(2) // 2 total position changes

      expect((await collateral.fees(treasuryB.address)).sub(totalFees)).to.be.within(0, 1)

      await product.settleAccount(user.address)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        DEPOSIT_AMOUNT.sub(makerFeePerPosition),
      )
      await product.settleAccount(userB.address)
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        DEPOSIT_AMOUNT.sub(makerFeePerPosition),
      )
    })

    it('charges global fees when global position nets out (taker)', async () => {
      const { user, userB, userC, chainlink, collateral, treasuryB } = instanceVars
      await depositTo(instanceVars, userC, product, utils.parseEther('10000'))

      // Don't charge a fee here
      await product.updateMakerFee(0)
      await product.updateTakerFee(0)
      await product.connect(userC).openMake(MAKE_POSITION)
      await product.connect(user).openTake(TAKE_POSITION)

      await chainlink.next()
      await product.settle()
      await product.settleAccount(userC.address)
      await product.settleAccount(user.address)
      const openPrice = (await product.currentVersion()).price

      // Charge a taker fee for future position changes
      await product.updateTakerFee(utils.parseEther('0.5'))
      await product.connect(user).closeTake(TAKE_POSITION)
      await product.connect(userB).openTake(TAKE_POSITION)

      // Return the same price so there is no PnL
      await chainlink.next()
      await product.settle()

      const currentVersion = await product.currentVersion()
      const takerFeePerPosition = Big18Math.mul(openPrice, TAKE_POSITION).div(2)
      const totalFees = takerFeePerPosition.mul(2) // 2 total position changes
      const takerPnL = Big18Math.mul(currentVersion.price.sub(openPrice), TAKE_POSITION).mul(-1)

      expect((await collateral.fees(treasuryB.address)).sub(totalFees)).to.be.within(0, 1)

      await product.settleAccount(user.address)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(
        DEPOSIT_AMOUNT.sub(takerFeePerPosition.add(takerPnL)),
      )

      await product.settleAccount(userB.address)
      expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(
        DEPOSIT_AMOUNT.sub(takerFeePerPosition),
      )
    })
  })
})

import { expect } from 'chai'
import 'hardhat'
import { BigNumber, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from './setupHelpers'
import { expectPositionEq, expectPrePositionEq } from '../testutil/types'
import { DataFeedContext } from './feedOracleHelper'
import {
  ReservoirFeedOracle__factory,
  TestnetProductProvider,
  TestnetProductProvider__factory,
} from '../../types/generated'
import { deployments } from 'hardhat'

const INITIAL_VERSION = BigNumber.from('73786976294838209800')

describe('Reservoir Oracle Product', () => {
  let instanceVars: InstanceVars
  let oracleFeed: DataFeedContext
  let baycUSDCProductProvider: TestnetProductProvider

  beforeEach(async () => {
    instanceVars = await deployProtocol()
    const { owner } = instanceVars

    // Reservoir has not deployed their feed adaptor to mainnet, so for now use Chainlink's DPI feed as a standin
    // TODO(arjun): Update this with Reservoir's mainnet deploy
    const baycUSDCFeed = (await deployments.get('ChainlinkDPIFeed')).address
    oracleFeed = new DataFeedContext(baycUSDCFeed, INITIAL_VERSION)
    await oracleFeed.init()

    const reservoirOracle = await new ReservoirFeedOracle__factory(owner).deploy(
      oracleFeed.feed.address,
      INITIAL_VERSION,
    )
    baycUSDCProductProvider = await new TestnetProductProvider__factory(owner).deploy(reservoirOracle.address, {
      minRate: 0,
      maxRate: utils.parseEther('5.00'),
      targetRate: utils.parseEther('0.80'),
      targetUtilization: utils.parseEther('0.80'),
    })
  })

  it('creates a product', async () => {
    const { owner, user, controller, collateral, treasuryB, dsu } = instanceVars

    await expect(controller.createCoordinator(owner.address))
      .to.emit(controller, 'CoordinatorCreated')
      .withArgs(1, owner.address)
    await expect(controller.updateCoordinatorTreasury(1, treasuryB.address))
      .to.emit(controller, 'CoordinatorTreasuryUpdated')
      .withArgs(1, treasuryB.address)

    const productAddress = await controller.callStatic.createProduct(1, baycUSDCProductProvider.address)
    await expect(controller.createProduct(1, baycUSDCProductProvider.address)).to.emit(controller, 'ProductCreated')

    await dsu.connect(user).approve(collateral.address, utils.parseEther('1000'))
    await collateral.connect(user).depositTo(user.address, productAddress, utils.parseEther('1000'))

    expect(await collateral['collateral(address)'](productAddress)).to.equal(utils.parseEther('1000'))
    expect(await collateral.shortfall(productAddress)).to.equal(0)
  })

  it('opens a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
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
    await oracleFeed.next()
    await product.settle()

    // Check global post-settlement state
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION.add(1))
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION.add(1)), { maker: POSITION, taker: 0 })
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
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION.add(1))
  })

  it('opens multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
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
    await oracleFeed.next()
    await product.settle()

    // Check global post-settlement state
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION.add(1))
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION.add(1)), { maker: POSITION, taker: 0 })
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
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION.add(1))
  })

  it('closes a make position', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).openMake(OPEN_POSITION)

    await expect(product.connect(user).closeMake(CLOSE_POSITION))
      .to.emit(product, 'MakeClosed')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION)

    // User state
    expect(await product.isClosed(user.address)).to.equal(true)
    expect(await product.maintenance(user.address)).to.equal(0)
    expect(await product.maintenanceNext(user.address)).to.equal(0)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
  })

  it('closes multiple make positions', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).openMake(OPEN_POSITION)
    await product.connect(user).closeMake(CLOSE_POSITION.div(2))

    await expect(product.connect(user).closeMake(CLOSE_POSITION.div(2)))
      .to.emit(product, 'MakeClosed')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION.div(2))

    // User state
    expect(await product.isClosed(user.address)).to.equal(true)
    expect(await product.maintenance(user.address)).to.equal(0)
    expect(await product.maintenanceNext(user.address)).to.equal(0)
    expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](user.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
  })

  it('opens a take position', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
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
    await oracleFeed.next()
    await chainlinkOracle.sync()

    // Another round
    await oracleFeed.next()
    await product.settle()

    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION.add(2))
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION.add(2)), {
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
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION.add(2))
  })

  it('opens multiple take positions', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlink, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
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
    await oracleFeed.next()
    await chainlinkOracle.sync()

    // Another round
    await oracleFeed.next()
    await product.settle()

    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION.add(2))
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION.add(2)), {
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
    expect(await product['latestVersion(address)'](userB.address)).to.equal(INITIAL_VERSION.add(2))
  })

  it('closes a take position', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).openTake(OPEN_TAKE_POSITION)).to.be.revertedWith(
      'InsufficientLiquidityError(0)',
    )
    await product.connect(user).openMake(OPEN_MAKE_POSITION)
    await product.connect(userB).openTake(OPEN_TAKE_POSITION)

    await expect(product.connect(userB).closeTake(CLOSE_TAKE_POSITION))
      .to.emit(product, 'TakeClosed')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION)

    // User State
    expect(await product.isClosed(userB.address)).to.equal(true)
    expect(await product.maintenance(userB.address)).to.equal(0)
    expect(await product.maintenanceNext(userB.address)).to.equal(0)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_MAKE_POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
  })

  it('closes multiple take positions', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).openTake(OPEN_TAKE_POSITION)).to.be.revertedWith(
      'InsufficientLiquidityError(0)',
    )
    await product.connect(user).openMake(OPEN_MAKE_POSITION)
    await product.connect(userB).openTake(OPEN_TAKE_POSITION)
    await product.connect(userB).closeTake(CLOSE_TAKE_POSITION.div(2))

    await expect(product.connect(userB).closeTake(CLOSE_TAKE_POSITION.div(2)))
      .to.emit(product, 'TakeClosed')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.div(2))

    // User State
    expect(await product.isClosed(userB.address)).to.equal(true)
    expect(await product.maintenance(userB.address)).to.equal(0)
    expect(await product.maintenanceNext(userB.address)).to.equal(0)
    expectPositionEq(await product.position(userB.address), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre(address)'](userB.address), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: 0, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expect(await product['latestVersion(address)'](user.address)).to.equal(INITIAL_VERSION)

    // Global State
    expect(await product['latestVersion()']()).to.equal(INITIAL_VERSION)
    expectPositionEq(await product.positionAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPrePositionEq(await product['pre()'](), {
      oracleVersion: INITIAL_VERSION,
      openPosition: { maker: OPEN_MAKE_POSITION, taker: 0 },
      closePosition: { maker: 0, taker: 0 },
    })
    expectPositionEq(await product.valueAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
    expectPositionEq(await product.shareAtVersion(INITIAL_VERSION), { maker: 0, taker: 0 })
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCProductProvider)

    await product.settle()
    await product.settle()
    await product.settleAccount(user.address)
    await product.settleAccount(user.address)
  })
})

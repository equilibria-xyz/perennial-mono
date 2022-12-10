import { expect } from 'chai'
import 'hardhat'
import { BigNumber, utils, constants } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo } from '../helpers/setupHelpers'
import { createPayoffDefinition, expectPositionEq, expectPrePositionEq } from '../../../../common/testutil/types'
import { DataFeedContext } from '../helpers/feedOracleHelper'
import {
  Product__factory,
  ReservoirFeedOracle,
  ReservoirFeedOracle__factory,
  TestnetContractPayoffProvider,
  TestnetContractPayoffProvider__factory,
} from '../../../types/generated'
import { deployments } from 'hardhat'

const VERSION_OFFSET = BigNumber.from('73786976294838209800')
const INITIAL_VERSION = BigNumber.from(1)
const DEFINITION = {
  name: 'Squeeth',
  symbol: 'SQTH',
  token: constants.AddressZero,
  reward: constants.AddressZero,
  payoffDefinition: createPayoffDefinition(),
  oracle: '',
}
const PARAMETER = {
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
    maker: 0,
    taker: 0,
  },
}

describe('Reservoir Oracle Product', () => {
  let instanceVars: InstanceVars
  let oracleFeed: DataFeedContext
  let reservoirOracle: ReservoirFeedOracle
  let baycUSDCPayoffProvider: TestnetContractPayoffProvider

  beforeEach(async () => {
    instanceVars = await deployProtocol()
    const { owner, dsu, rewardToken } = instanceVars
    DEFINITION.token = dsu.address
    DEFINITION.reward = rewardToken.address

    // Reservoir has not deployed their feed adaptor to mainnet, so for now use Chainlink's DPI feed as a standin
    // TODO(arjun): Update this with Reservoir's mainnet deploy
    const baycUSDCFeed = (await deployments.get('ChainlinkDPIFeed')).address
    oracleFeed = new DataFeedContext(baycUSDCFeed, VERSION_OFFSET)
    await oracleFeed.init()

    reservoirOracle = await new ReservoirFeedOracle__factory(owner).deploy(oracleFeed.feed.address, VERSION_OFFSET)
    baycUSDCPayoffProvider = await new TestnetContractPayoffProvider__factory(owner).deploy()
    DEFINITION.oracle = reservoirOracle.address
    DEFINITION.payoffDefinition = createPayoffDefinition({ contractAddress: baycUSDCPayoffProvider.address })

    await oracleFeed.next()
  })

  it('creates a product', async () => {
    const { owner, user, controller, treasuryB, dsu, lens } = instanceVars

    const productAddress = await controller.callStatic.createProduct(DEFINITION, PARAMETER)
    const product = Product__factory.connect(productAddress, owner)
    await expect(controller.createProduct(DEFINITION, PARAMETER)).to.emit(controller, 'ProductCreated')
    await product.connect(owner).acceptOwner()
    await product.connect(owner).updateTreasury(treasuryB.address)

    await dsu.connect(user).approve(product.address, utils.parseEther('1000'))
    await product.connect(user).update(0, utils.parseEther('1000'))

    expect(await lens.callStatic['collateral(address)'](product.address)).to.equal(utils.parseEther('1000'))
  })

  it('opens a make position', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    await expect(product.connect(user).update(POSITION.mul(-1), 0))
      .to.emit(product, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION, 0)

    // Check user is in the correct state
    expect((await product.accounts(user.address))._position).to.equal(0)
    expect((await product.accounts(user.address))._pre).to.equal(0)
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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })

    // Settle the product with a new oracle version
    await oracleFeed.next()
    await product.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION.add(1))
    expectPositionEq((await product.versions(INITIAL_VERSION.add(1)))._position, { maker: POSITION, taker: 0 })
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
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION.add(1))
  })

  it('opens multiple make positions', async () => {
    const POSITION = utils.parseEther('0.0001')
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))

    await product.connect(user).update(POSITION.div(2).mul(-1), 0)

    await expect(product.connect(user).update(POSITION.div(2).mul(-1), 0))
      .to.emit(product, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, POSITION.div(2), 0)

    // Check user is in the correct state
    expect((await product.accounts(user.address))._position).to.equal(0)
    expect((await product.accounts(user.address))._pre).to.equal(0)
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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })

    // Settle the product with a new oracle version
    await oracleFeed.next()
    await product.settle(constants.AddressZero)

    // Check global post-settlement state
    expect(await product.latestVersion()).to.equal(INITIAL_VERSION.add(1))
    expectPositionEq((await product.versions(INITIAL_VERSION.add(1)))._position, { maker: POSITION, taker: 0 })
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
    expect(await product.latestVersions(user.address)).to.equal(INITIAL_VERSION.add(1))
  })

  it('closes a make position', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, lens } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).update(OPEN_POSITION.mul(-1), 0)

    await expect(product.connect(user).update(CLOSE_POSITION, 0))
      .to.emit(product, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION, 0)

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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })
  })

  it('closes multiple make positions', async () => {
    const OPEN_POSITION = utils.parseEther('0.0001')
    const CLOSE_POSITION = utils.parseEther('0.0001')
    const { user, lens } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await product.connect(user).update(OPEN_POSITION.mul(-1), 0)
    await product.connect(user).update(CLOSE_POSITION.div(2), 0)

    await expect(product.connect(user).update(CLOSE_POSITION.div(2), 0))
      .to.emit(product, 'Updated')
      .withArgs(user.address, INITIAL_VERSION, CLOSE_POSITION.div(2), 0)

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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })
  })

  it('opens a take position', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await product.connect(user).update(MAKE_POSITION.mul(-1), 0)
    await expect(product.connect(userB).update(TAKE_POSITION, 0))
      .to.emit(product, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION)

    // User State
    expect((await product.accounts(user.address))._position).to.equal(0)
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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })

    // One round
    await oracleFeed.next()
    await chainlinkOracle.sync()

    // Another round
    await oracleFeed.next()
    await product.settle(constants.AddressZero)

    expect(await product.latestVersion()).to.equal(INITIAL_VERSION.add(2))
    expectPositionEq((await product.versions(INITIAL_VERSION.add(2)))._position, {
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
    expect((await product.accounts(user.address))._position).to.equal(TAKE_POSITION)
    expect((await product.accounts(userB.address))._pre).to.equal(0)
    expect(await product.latestVersions(userB.address)).to.equal(INITIAL_VERSION.add(2))
  })

  it('opens multiple take positions', async () => {
    const MAKE_POSITION = utils.parseEther('0.0001')
    const TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, chainlinkOracle } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await product.connect(user).update(MAKE_POSITION.mul(-1), 0)
    await product.connect(userB).update(TAKE_POSITION.div(2), 0)

    await expect(product.connect(userB).update(TAKE_POSITION.div(2), 0))
      .to.emit(product, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, TAKE_POSITION.div(2), 0)

    // User State
    expect((await product.accounts(user.address))._position).to.equal(0)
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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })

    // One round
    await oracleFeed.next()
    await chainlinkOracle.sync()

    // Another round
    await oracleFeed.next()
    await product.settle(constants.AddressZero)

    expect(await product.latestVersion()).to.equal(INITIAL_VERSION.add(2))
    expectPositionEq((await product.versions(INITIAL_VERSION.add(2)))._position, {
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
    expect((await product.accounts(user.address))._position).to.equal(TAKE_POSITION)
    expect((await product.accounts(userB.address))._pre).to.equal(0)
    expect(await product.latestVersions(userB.address)).to.equal(INITIAL_VERSION.add(2))
  })

  it('closes a take position', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, lens } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).update(OPEN_TAKE_POSITION, 0)).to.be.revertedWith(
      'InsufficientLiquidityError(0)',
    )
    await product.connect(user).update(OPEN_MAKE_POSITION.mul(-1), 0)
    await product.connect(userB).update(OPEN_TAKE_POSITION, 0)

    await expect(product.connect(userB).update(CLOSE_TAKE_POSITION.mul(-1), 0))
      .to.emit(product, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION, 0)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, product.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, product.address)).to.equal(0)
    expect((await product.accounts(user.address))._position).to.equal(0)
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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })
  })

  it('closes multiple take positions', async () => {
    const OPEN_MAKE_POSITION = utils.parseEther('0.0001')
    const OPEN_TAKE_POSITION = utils.parseEther('0.00001')
    const CLOSE_TAKE_POSITION = utils.parseEther('0.00001')
    const { user, userB, lens } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)
    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))

    await expect(product.connect(userB).update(OPEN_TAKE_POSITION, 0)).to.be.revertedWith(
      'InsufficientLiquidityError(0)',
    )
    await product.connect(user).update(OPEN_MAKE_POSITION.mul(-1), 0)
    await product.connect(userB).update(OPEN_TAKE_POSITION, 0)
    await product.connect(userB).update(CLOSE_TAKE_POSITION.div(2).mul(-1), 0)

    await expect(product.connect(userB).update(CLOSE_TAKE_POSITION.div(2).mul(-1), 0))
      .to.emit(product, 'Updated')
      .withArgs(userB.address, INITIAL_VERSION, CLOSE_TAKE_POSITION.div(2), 0)

    // User State
    expect(await lens.callStatic.maintenance(userB.address, product.address)).to.equal(0)
    expect(await lens.callStatic.maintenanceNext(userB.address, product.address)).to.equal(0)
    expect((await product.accounts(user.address))._position).to.equal(0)
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
    expectPositionEq((await product.versions(INITIAL_VERSION))._reward, { maker: 0, taker: 0 })
  })

  it('settle no op (gas test)', async () => {
    const { user } = instanceVars

    const product = await createProduct(instanceVars, baycUSDCPayoffProvider, reservoirOracle)

    await product.settle(user.address)
    await product.settle(user.address)
  })
})

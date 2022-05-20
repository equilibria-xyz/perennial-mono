import 'hardhat'
import { expect } from 'chai'
import { utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, INITIAL_VERSION } from './setupHelpers'
import { expectPositionEq, expectPrePositionEq } from '../testutil/types'
import { currentBlockTimestamp } from '../testutil/time'
import { time } from '../testutil'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY

describe.only('Incentivizer', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('initializes', async () => {
    const { controller, incentivizer } = instanceVars

    expect((await incentivizer.controller()).toUpperCase()).to.equal(controller.address.toUpperCase())
  })

  it('reverts if already initialized', async () => {
    const { incentivizer, controller } = instanceVars

    await expect(incentivizer.initialize(controller.address)).to.be.revertedWith(
      'UInitializableAlreadyInitializedError()',
    )
  })

  it('creates a protocol owned program', async () => {
    const { owner, incentivizer, incentiveToken, treasuryA } = instanceVars

    await incentiveToken.mint(owner.address, utils.parseEther('10000'))
    await incentiveToken.approve(incentivizer.address, utils.parseEther('10000'))
    const product = await createProduct(instanceVars)
    const now = await currentBlockTimestamp()
    const programInfo = {
      product: product.address,
      token: incentiveToken.address,
      amount: {
        maker: utils.parseEther('8000'),
        taker: utils.parseEther('2000'),
      },
      start: now + HOUR,
      duration: 30 * DAY,
      grace: 7 * DAY,
    }
    const PROGRAM_ID = 0
    const returnValue = await incentivizer.callStatic.create(programInfo)
    expect(returnValue).to.equal(PROGRAM_ID)

    await expect(incentivizer.create(programInfo))
      .to.emit(incentivizer, 'ProgramCreated')
      .withArgs(
        0,
        product.address,
        incentiveToken.address,
        utils.parseEther('8000'),
        utils.parseEther('2000'),
        now + HOUR,
        30 * DAY,
        7 * DAY,
        0,
      )

    const program = await incentivizer.programInfos(PROGRAM_ID)
    expect(program.start).to.equal(now + HOUR)
    expect(program.duration).to.equal(30 * DAY)
    expect(program.grace).to.equal(7 * DAY)
    expect(program.product).to.equal(product.address)
    expect(program.token).to.equal(incentiveToken.address)
    expect(program.amount.maker).to.equal(utils.parseEther('8000'))
    expect(program.amount.taker).to.equal(utils.parseEther('2000'))

    expect(await incentivizer.available(PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.closed(PROGRAM_ID)).to.equal(false)
    expect(await incentivizer.versionComplete(PROGRAM_ID)).to.equal(0)

    expect(await incentivizer.programsForLength(product.address)).to.equal(1)
    expect(await incentivizer.programsForAt(product.address, 0)).to.equal(0)

    expect(await incentivizer.owner(PROGRAM_ID)).to.equal(owner.address)
    expect(await incentivizer.treasury(PROGRAM_ID)).to.equal(treasuryA.address)
  })
  it('creates a product owned program', async () => {
    const { userB, incentivizer, incentiveToken, treasuryB, controller } = instanceVars

    await incentiveToken.mint(userB.address, utils.parseEther('10000'))
    await incentiveToken.connect(userB).approve(incentivizer.address, utils.parseEther('10000'))
    const product = await createProduct(instanceVars)
    await controller.updateCoordinatorPendingOwner(1, userB.address)
    await controller.connect(userB).acceptCoordinatorOwner(1)

    const now = await currentBlockTimestamp()
    const programInfo = {
      product: product.address,
      token: incentiveToken.address,
      amount: {
        maker: utils.parseEther('8000'),
        taker: utils.parseEther('2000'),
      },
      start: now + HOUR,
      duration: 30 * DAY,
      grace: 7 * DAY,
    }
    const PROGRAM_ID = 0
    const returnValue = await incentivizer.connect(userB).callStatic.create(programInfo)
    expect(returnValue).to.equal(PROGRAM_ID)

    await expect(incentivizer.connect(userB).create(programInfo))
      .to.emit(incentivizer, 'ProgramCreated')
      .withArgs(
        0,
        product.address,
        incentiveToken.address,
        utils.parseEther('8000'),
        utils.parseEther('2000'),
        now + HOUR,
        30 * DAY,
        7 * DAY,
        0,
      )

    const program = await incentivizer.programInfos(PROGRAM_ID)
    expect(program.start).to.equal(now + HOUR)
    expect(program.duration).to.equal(30 * DAY)
    expect(program.grace).to.equal(7 * DAY)
    expect(program.product).to.equal(product.address)
    expect(program.token).to.equal(incentiveToken.address)
    expect(program.amount.maker).to.equal(utils.parseEther('8000'))
    expect(program.amount.taker).to.equal(utils.parseEther('2000'))

    expect(await incentivizer.available(PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.closed(PROGRAM_ID)).to.equal(false)
    expect(await incentivizer.versionComplete(PROGRAM_ID)).to.equal(0)

    expect(await incentivizer.programsForLength(product.address)).to.equal(1)
    expect(await incentivizer.programsForAt(product.address, 0)).to.equal(0)

    expect(await incentivizer.owner(PROGRAM_ID)).to.equal(userB.address)
    expect(await incentivizer.treasury(PROGRAM_ID)).to.equal(treasuryB.address)
  })

  it.only('correctly syncs', async () => {
    const { owner, user, userB, incentivizer, incentiveToken, chainlink } = instanceVars

    await incentiveToken.mint(owner.address, utils.parseEther('10000'))
    await incentiveToken.approve(incentivizer.address, utils.parseEther('10000'))
    const product = await createProduct(instanceVars)

    await time.increase(-10 * DAY)
    const now = await currentBlockTimestamp()

    const programInfo = {
      product: product.address,
      token: incentiveToken.address,
      amount: {
        maker: utils.parseEther('8000'),
        taker: utils.parseEther('2000'),
      },
      start: now + MINUTE,
      duration: 30 * DAY,
      grace: 7 * DAY,
    }
    const PROGRAM_ID = 0
    await incentivizer.create(programInfo)

    time.increase(10 * DAY)

    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(utils.parseEther('0.0001'))
    await product.connect(userB).openTake(utils.parseEther('0.00005'))

    await chainlink.next()
    await product.settle()
    //await product.settleAccount(user.address) // a -> b == c

    await chainlink.next()
    await chainlink.next()
    await chainlink.next()

    await product.settle()
    await product.settleAccount(user.address) // a -> c / a -> b -> c
    // await product.settleAccount(user.address) // a == c

    console.log(await incentivizer.available(PROGRAM_ID))
    console.log(await incentivizer.settled(user.address, PROGRAM_ID))
  })
})

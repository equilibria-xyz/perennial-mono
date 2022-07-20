import 'hardhat'
import { expect } from 'chai'
import { BigNumber, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct, depositTo, createIncentiveProgram } from '../helpers/setupHelpers'
import { expectProgramInfoEq } from '../../testutil/types'
import { currentBlockTimestamp } from '../../testutil/time'
import { time } from '../../testutil'
import { Product } from '../../../types/generated'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY
const PRODUCT_COORDINATOR_ID = 1

describe('Incentivizer', () => {
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
      'UInitializableAlreadyInitializedError(1)',
    )
  })

  it('creates a protocol owned program', async () => {
    const { owner, incentivizer, incentiveToken, treasuryA } = instanceVars

    await incentiveToken.mint(owner.address, utils.parseEther('10000'))
    await incentiveToken.approve(incentivizer.address, utils.parseEther('10000'))
    const product = await createProduct(instanceVars)
    const now = await currentBlockTimestamp()
    const programInfo = {
      coordinatorId: 0,
      token: incentiveToken.address,
      amount: {
        maker: utils.parseEther('8000'),
        taker: utils.parseEther('2000'),
      },
      start: now + HOUR,
      duration: 30 * DAY,
    }
    const PROGRAM_ID = 0
    const returnValue = await incentivizer.callStatic.create(product.address, programInfo)
    expect(returnValue).to.equal(PROGRAM_ID)

    await expect(incentivizer.create(product.address, programInfo))
      .to.emit(incentivizer, 'ProgramCreated')
      .withArgs(
        product.address,
        PROGRAM_ID,
        0,
        incentiveToken.address,
        utils.parseEther('8000'),
        utils.parseEther('2000'),
        now + HOUR,
        30 * DAY,
        0,
      )

    expectProgramInfoEq(programInfo, await incentivizer.programInfos(product.address, PROGRAM_ID))

    expect(await incentivizer.active(product.address)).to.equal(1)
    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.versionStarted(product.address, PROGRAM_ID)).to.equal(0)
    expect(await incentivizer.versionComplete(product.address, PROGRAM_ID)).to.equal(0)

    expect(await incentivizer.owner(product.address, PROGRAM_ID)).to.equal(owner.address)
    expect(await incentivizer.treasury(product.address, PROGRAM_ID)).to.equal(treasuryA.address)
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
      coordinatorId: PRODUCT_COORDINATOR_ID,
      token: incentiveToken.address,
      amount: {
        maker: utils.parseEther('8000'),
        taker: utils.parseEther('2000'),
      },
      start: now + HOUR,
      duration: 30 * DAY,
    }
    const PROGRAM_ID = 0
    const returnValue = await incentivizer.connect(userB).callStatic.create(product.address, programInfo)
    expect(returnValue).to.equal(PROGRAM_ID)

    await expect(incentivizer.connect(userB).create(product.address, programInfo))
      .to.emit(incentivizer, 'ProgramCreated')
      .withArgs(
        product.address,
        PROGRAM_ID,
        PRODUCT_COORDINATOR_ID,
        incentiveToken.address,
        utils.parseEther('8000'),
        utils.parseEther('2000'),
        now + HOUR,
        30 * DAY,
        0,
      )

    expectProgramInfoEq(programInfo, await incentivizer.programInfos(product.address, PROGRAM_ID))
    expect(await incentivizer.count(product.address)).to.equal(1)

    expect(await incentivizer.active(product.address)).to.equal(1)
    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.versionStarted(product.address, PROGRAM_ID)).to.equal(0)
    expect(await incentivizer.versionComplete(product.address, PROGRAM_ID)).to.equal(0)

    expect(await incentivizer.owner(product.address, PROGRAM_ID)).to.equal(userB.address)
    expect(await incentivizer.treasury(product.address, PROGRAM_ID)).to.equal(treasuryB.address)
  })

  it('correctly syncs', async () => {
    const { user, userB, incentivizer, chainlink } = instanceVars

    const product = await createProduct(instanceVars)

    await time.increase(-YEAR)
    const PROGRAM_ID = await createIncentiveProgram(instanceVars, product)
    await time.increase(YEAR)

    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await expect(product.connect(user).openMake(utils.parseEther('0.0001')))
      .to.emit(incentivizer, 'ProgramStarted')
      .withArgs(product.address, PROGRAM_ID, 2472)
    await product.connect(userB).openTake(utils.parseEther('0.00005'))

    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.unclaimed(product.address, user.address, PROGRAM_ID)).to.equal(0)

    await chainlink.next()
    await product.settle()

    await chainlink.next()
    await chainlink.next()
    await chainlink.next()
    await product.settle()

    await product.settleAccount(user.address)
    expect(await incentivizer.unclaimed(product.address, user.address, PROGRAM_ID)).to.equal('423010973936898252')

    await product.settleAccount(userB.address)
    expect(await incentivizer.unclaimed(product.address, userB.address, PROGRAM_ID)).to.equal('105752743484224563')

    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal('9999471236282578877185')
  })

  it('completes after end', async () => {
    const { user, userB, incentivizer, chainlink, incentiveToken, treasuryA } = instanceVars

    const product = await createProduct(instanceVars)

    await time.increase(-YEAR)
    const PROGRAM_ID = await createIncentiveProgram(instanceVars, product)
    await time.increase(YEAR)

    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(utils.parseEther('0.0001'))
    await product.connect(userB).openTake(utils.parseEther('0.00005'))

    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.unclaimed(product.address, user.address, PROGRAM_ID)).to.equal(0)

    await chainlink.next()
    await product.settle()

    await chainlink.next()
    await chainlink.next()
    await product.settle()

    await chainlink.nextWithTimestampModification(ts => ts.add(YEAR))
    await expect(product.settle())
      .to.emit(incentiveToken, 'Transfer')
      .withArgs(incentivizer.address, treasuryA.address, '9999662208504801097393') // Refund Amount
      .to.emit(incentivizer, 'ProgramComplete')
      .withArgs(product.address, PROGRAM_ID, 2475)

    await product.settleAccount(user.address)
    expect(await incentivizer.unclaimed(product.address, user.address, PROGRAM_ID)).to.equal('188786008230451956')
    await expect(incentivizer.connect(user)['claim(address,uint256[])'](product.address, [PROGRAM_ID]))
      .to.emit(incentiveToken, 'Transfer')
      .withArgs(incentivizer.address, user.address, '188786008230451956')

    await product.settleAccount(userB.address)
    expect(await incentivizer.unclaimed(product.address, userB.address, PROGRAM_ID)).to.equal('47196502057612989')
    await expect(incentivizer.connect(userB)['claim(address,uint256[])'](product.address, [PROGRAM_ID]))
      .to.emit(incentiveToken, 'Transfer')
      .withArgs(incentivizer.address, userB.address, '47196502057612989')

    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal('101808984910837662')
    expect(await incentivizer.active(product.address)).to.equal(0)
  })

  it('completes early', async () => {
    const { user, userB, incentivizer, chainlink, incentiveToken, treasuryA } = instanceVars

    const product = await createProduct(instanceVars)

    await time.increase(-YEAR)
    const PROGRAM_ID = await createIncentiveProgram(instanceVars, product)
    await time.increase(YEAR)

    await depositTo(instanceVars, user, product, utils.parseEther('1000'))
    await depositTo(instanceVars, userB, product, utils.parseEther('1000'))
    await product.connect(user).openMake(utils.parseEther('0.0001'))
    await product.connect(userB).openTake(utils.parseEther('0.00005'))

    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal(utils.parseEther('10000'))
    expect(await incentivizer.unclaimed(product.address, user.address, PROGRAM_ID)).to.equal(0)

    await chainlink.next()
    await product.settle()

    await chainlink.next()
    await chainlink.next()
    await product.settle()

    await expect(incentivizer.complete(product.address, PROGRAM_ID))
      .to.emit(incentiveToken, 'Transfer')
      .withArgs(incentivizer.address, treasuryA.address, '9999662208504801097393') // Refund Amount
      .to.emit(incentivizer, 'ProgramComplete')
      .withArgs(product.address, PROGRAM_ID, 2475)

    await product.settleAccount(user.address)
    expect(await incentivizer.unclaimed(product.address, user.address, PROGRAM_ID)).to.equal('188786008230451956')
    await expect(incentivizer.connect(user)['claim(address,uint256[])'](product.address, [PROGRAM_ID]))
      .to.emit(incentiveToken, 'Transfer')
      .withArgs(incentivizer.address, user.address, '188786008230451956')

    await product.settleAccount(userB.address)
    expect(await incentivizer.unclaimed(product.address, userB.address, PROGRAM_ID)).to.equal('47196502057612989')
    await expect(incentivizer.connect(userB)['claim(address,uint256[])'](product.address, [PROGRAM_ID]))
      .to.emit(incentiveToken, 'Transfer')
      .withArgs(incentivizer.address, userB.address, '47196502057612989')

    expect(await incentivizer.available(product.address, PROGRAM_ID)).to.equal('101808984910837662')
    expect(await incentivizer.active(product.address)).to.equal(0)
  })

  describe('multiple programs on multiple products', async () => {
    let product0: Product
    let product1: Product
    let program0: BigNumber
    let program1: BigNumber

    beforeEach(async () => {
      instanceVars.controller.updateIncentivizationFee(utils.parseEther('0.25'))
      await time.increase(-YEAR)
      product0 = await createProduct(instanceVars)
      product1 = await createProduct(instanceVars)
      program0 = await createIncentiveProgram(instanceVars, product0)
      program1 = await createIncentiveProgram(instanceVars, product1, true, {
        maker: utils.parseEther('4000'),
        taker: utils.parseEther('1000'),
      })
      await time.increase(YEAR)
    })

    it('correctly syncs', async () => {
      const { user, userB, treasuryA, incentivizer, chainlink, incentiveToken } = instanceVars

      await depositTo(instanceVars, user, product0, utils.parseEther('1000'))
      await depositTo(instanceVars, userB, product0, utils.parseEther('1000'))
      await product0.connect(user).openMake(utils.parseEther('0.0001'))
      await product0.connect(userB).openTake(utils.parseEther('0.00005'))

      await depositTo(instanceVars, user, product1, utils.parseEther('1000'))
      await depositTo(instanceVars, userB, product1, utils.parseEther('1000'))
      await product1.connect(user).openMake(utils.parseEther('0.0001'))
      await product1.connect(userB).openTake(utils.parseEther('0.00005'))

      expect(await incentivizer.available(product0.address, program0)).to.equal(utils.parseEther('7500'))
      expect(await incentivizer.available(product1.address, program1)).to.equal(utils.parseEther('3750'))

      await chainlink.next()
      await product0.settle()
      await product1.settle()

      await chainlink.next()
      await chainlink.next()
      await chainlink.next()
      await product0.settle()
      await product1.settle()

      await product0.settleAccount(user.address)
      await product1.settleAccount(user.address)
      expect(await incentivizer.unclaimed(product0.address, user.address, program0)).to.equal('317258230452673689')
      expect(await incentivizer.unclaimed(product1.address, user.address, program1)).to.equal('158629115226335611')
      await expect(
        incentivizer
          .connect(user)
          ['claim(address[],uint256[][])']([product0.address, product1.address], [[program0], [program1]]),
      )
        .to.emit(incentiveToken, 'Transfer')
        .withArgs(incentivizer.address, user.address, '317258230452673689')
        .to.emit(incentiveToken, 'Transfer')
        .withArgs(incentivizer.address, user.address, '158629115226335611')

      await product0.settleAccount(userB.address)
      await product1.settleAccount(userB.address)
      expect(await incentivizer.unclaimed(product0.address, userB.address, program0)).to.equal('79314557613166572')
      expect(await incentivizer.unclaimed(product1.address, userB.address, program1)).to.equal('39657278806583286')
      await expect(
        incentivizer
          .connect(userB)
          ['claim(address[],uint256[][])']([product0.address, product1.address], [[program0], [program1]]),
      )
        .to.emit(incentiveToken, 'Transfer')
        .withArgs(incentivizer.address, userB.address, '79314557613166572')
        .to.emit(incentiveToken, 'Transfer')
        .withArgs(incentivizer.address, userB.address, '39657278806583286')

      expect(await incentivizer.available(product0.address, program0)).to.equal('7499603427211934159739')
      expect(await incentivizer.available(product1.address, program1)).to.equal('3749801713605967081103')

      expect(await incentivizer.fees(incentiveToken.address)).to.equal(utils.parseEther('3750'))
      await expect(incentivizer.claimFee([incentiveToken.address]))
        .to.emit(incentiveToken, 'Transfer')
        .withArgs(incentivizer.address, treasuryA.address, utils.parseEther('3750'))
    }).timeout(120000)
  })
})

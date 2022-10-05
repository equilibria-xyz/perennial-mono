import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { time } from '../../../../common/testutil'
import { Product } from '../../../types/generated'
import { IMultiInvoker } from '../../../types/generated/contracts/interfaces/IMultiInvoker'
import { buildInvokerActions, InvokerAction } from '../../util'
import { YEAR } from '../core/incentivizer.test'

import { InstanceVars, deployProtocol, createProduct, createIncentiveProgram, depositTo } from '../helpers/setupHelpers'

describe('MultiInvoker', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  describe('#initialize', () => {
    it('sets the correct approvals', async () => {
      const { multiInvoker, usdc, dsu, batcher, collateral } = instanceVars

      expect(await dsu.allowance(multiInvoker.address, collateral.address)).to.equal(constants.MaxUint256)
      expect(await dsu.allowance(multiInvoker.address, await batcher.RESERVE())).to.equal(constants.MaxUint256)
      expect(await usdc.allowance(multiInvoker.address, batcher.address)).to.equal(constants.MaxUint256)
    })

    it('reverts if already initialized', async () => {
      await expect(instanceVars.multiInvoker.initialize()).to.be.revertedWith(
        'UInitializableAlreadyInitializedError(1)',
      )
    })
  })

  describe('common chains', async () => {
    let product: Product
    let actions: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
    let partialActions: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
    let position: BigNumber
    let amount: BigNumber
    let programs: number[]

    beforeEach(async () => {
      const { user, dsu, usdc, usdcHolder, multiInvoker } = instanceVars

      await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)
      await usdc.connect(user).approve(multiInvoker.address, constants.MaxUint256)
      await dsu.connect(user).approve(multiInvoker.address, constants.MaxUint256)

      product = await createProduct(instanceVars)
      await time.increase(-YEAR)
      const PROGRAM_ID = await createIncentiveProgram(instanceVars, product)
      await time.increase(YEAR)

      position = utils.parseEther('0.001')
      amount = utils.parseEther('10000')
      programs = [PROGRAM_ID.toNumber()]
      actions = buildInvokerActions(user.address, product.address, position, amount, programs)
      partialActions = buildInvokerActions(user.address, product.address, position.div(2), amount.div(2), programs)
    })

    it('does nothing on NOOP', async () => {
      const { user, multiInvoker } = instanceVars

      const tx = await multiInvoker.connect(user).invoke([actions.NOOP])
      const receipt = await tx.wait()
      expect(receipt.status).to.equal(1)
      expect(receipt.logs.length).to.equal(0)
    })

    it('performs a WRAP, DEPOSIT, and OPEN_MAKE chain', async () => {
      const { user, multiInvoker, batcher, collateral, usdc } = instanceVars

      await expect(multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 100000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, 2472, position)
    })

    it('performs a DEPOSIT and OPEN_MAKE chain', async () => {
      const { user, multiInvoker, collateral } = instanceVars

      await expect(multiInvoker.connect(user).invoke([actions.DEPOSIT, actions.OPEN_MAKE]))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, 2472, position)
    })

    it('performs a CLOSE_MAKE, WITHDRAW, and CLAIM chain', async () => {
      const { user, userB, multiInvoker, incentivizer, chainlink, collateral } = instanceVars

      await multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE])
      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openTake(position.div(2))

      await chainlink.next()
      await product.settle()

      await chainlink.next()
      await chainlink.next()
      await chainlink.next()
      await product.settle()

      await product.connect(userB).closeTake(position.div(2))

      await expect(
        multiInvoker.connect(user).invoke([partialActions.CLOSE_MAKE, partialActions.WITHDRAW, actions.CLAIM]),
      )
        .to.emit(product, 'MakeClosed')
        .withArgs(user.address, 2473, position.div(2))
        .to.emit(collateral, 'Withdraw')
        .withArgs(user.address, product.address, amount.div(2))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, programs[0], '423010973936898252')
    })

    it('performs a CLOSE_MAKE and DEPOSIT', async () => {
      const { user, multiInvoker, chainlink, collateral } = instanceVars

      await multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE])

      await chainlink.next()

      await expect(multiInvoker.connect(user).invoke([partialActions.CLOSE_MAKE, partialActions.DEPOSIT]))
        .to.emit(product, 'MakeClosed')
        .withArgs(user.address, 2473, position.div(2))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount.div(2))
    })

    it('performs a WRAP, DEPOSIT, and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvoker, batcher, collateral, usdc } = instanceVars

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      await expect(multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, 2472, position)
    })

    it('performs a DEPOSIT and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvoker, collateral } = instanceVars

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      await expect(multiInvoker.connect(user).invoke([actions.DEPOSIT, actions.OPEN_TAKE]))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, 2472, position)
    })

    it('performs a CLOSE_TAKE and DEPOSIT chain', async () => {
      const { user, userB, multiInvoker, collateral, chainlink } = instanceVars

      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openMake(position)
      await multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE])

      await chainlink.next()

      await expect(multiInvoker.connect(user).invoke([partialActions.CLOSE_TAKE, partialActions.DEPOSIT]))
        .to.emit(product, 'TakeClosed')
        .withArgs(user.address, 2473, position.div(2))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount.div(2))
    })

    it('performs a CLOSE_TAKE, WITHDRAW, and CLAIM chain', async () => {
      const { user, userB, multiInvoker, incentivizer, collateral, chainlink } = instanceVars

      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openMake(position)
      await multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE])

      await chainlink.next()
      await product.settle()

      await chainlink.next()
      await chainlink.next()
      await chainlink.next()
      await product.settle()

      await expect(
        multiInvoker.connect(user).invoke([partialActions.CLOSE_TAKE, partialActions.WITHDRAW, actions.CLAIM]),
      )
        .to.emit(product, 'TakeClosed')
        .withArgs(user.address, 2473, position.div(2))
        .to.emit(collateral, 'Withdraw')
        .withArgs(user.address, product.address, amount.div(2))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, programs[0], '105752743484224563')
    })

    it('performs a WITHDRAW and UNWRAP chain', async () => {
      const { user, multiInvoker, batcher, usdc, collateral } = instanceVars

      // Load the Reserve with some USDC
      await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
      await batcher.connect(user).wrap(amount, user.address)
      await batcher.rebalance()

      // Deposit the collateral to withdraw
      await multiInvoker.connect(user).invoke([actions.DEPOSIT])

      await expect(multiInvoker.connect(user).invoke([actions.WITHDRAW, actions.UNWRAP]))
        .to.emit(collateral, 'Withdraw')
        .withArgs(user.address, product.address, amount)
        .to.emit(batcher.RESERVE(), 'Redeem')
        .withArgs(multiInvoker.address, amount)
        .to.emit(usdc, 'Transfer')
        .withArgs(multiInvoker.address, user.address, 10000e6)
    })
  })
})

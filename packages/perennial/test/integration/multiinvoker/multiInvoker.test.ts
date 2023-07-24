import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { MultiInvoker__factory, Product, TestnetVault, TestnetVault__factory } from '../../../types/generated'
import { IMultiInvoker } from '../../../types/generated/contracts/interfaces/IMultiInvoker.sol/IMultiInvoker'
import { buildInvokerActions, InvokerAction } from '../../util'

import {
  InstanceVars,
  deployProtocol,
  createProduct,
  createIncentiveProgram,
  depositTo,
  INITIAL_VERSION,
} from '../helpers/setupHelpers'

describe('MultiInvoker', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  describe('#initialize', () => {
    it('sets the correct contract addresses', async () => {
      const { multiInvoker, usdc, dsu, batcher, controller, collateral, reserve } = instanceVars

      expect((await multiInvoker.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
      expect((await multiInvoker.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
      expect((await multiInvoker.batcher()).toLowerCase()).to.equal(batcher.address.toLowerCase())
      expect((await multiInvoker.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
      expect((await multiInvoker.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
      expect((await multiInvoker.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
    })

    it('sets the correct approvals', async () => {
      const { multiInvoker, usdc, dsu, batcher, collateral, reserve } = instanceVars

      expect(await dsu.allowance(multiInvoker.address, collateral.address)).to.equal(constants.MaxUint256)
      expect(await dsu.allowance(multiInvoker.address, batcher.address)).to.equal(constants.MaxUint256)
      expect(await dsu.allowance(multiInvoker.address, reserve.address)).to.equal(constants.MaxUint256)
      expect(await usdc.allowance(multiInvoker.address, batcher.address)).to.equal(constants.MaxUint256)
      expect(await usdc.allowance(multiInvoker.address, reserve.address)).to.equal(constants.MaxUint256)
    })

    it('reverts if already initialized', async () => {
      await expect(instanceVars.multiInvoker.initialize())
        .to.be.revertedWithCustomError(instanceVars.multiInvoker, 'UInitializableAlreadyInitializedError')
        .withArgs(2)
    })
  })

  describe('common chains', async () => {
    let product: Product
    let actions: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
    let partialActions: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
    let actionsUnwrapped: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
    let position: BigNumber
    let amount: BigNumber
    let programs: number[]
    let vault: TestnetVault
    let vaultAmount: BigNumber
    let feeAmount: BigNumber

    beforeEach(async () => {
      const { owner, user, dsu, usdc, usdcHolder, multiInvoker } = instanceVars

      await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)
      await usdc.connect(user).approve(multiInvoker.address, constants.MaxUint256)
      await dsu.connect(user).approve(multiInvoker.address, constants.MaxUint256)

      product = await createProduct(instanceVars)
      const PROGRAM_ID = await createIncentiveProgram(instanceVars, product)
      vault = await new TestnetVault__factory(owner).deploy(dsu.address)
      await vault._incrementVersion()

      position = utils.parseEther('0.001')
      amount = utils.parseEther('10000')
      programs = [PROGRAM_ID.toNumber()]
      vaultAmount = amount
      feeAmount = utils.parseEther('10')

      actions = buildInvokerActions({
        userAddress: user.address,
        productAddress: product.address,
        position,
        amount,
        programs,
        vaultAddress: vault.address,
        vaultAmount,
        feeAmount: feeAmount,
        wrappedFee: true,
      })

      partialActions = buildInvokerActions({
        userAddress: user.address,
        productAddress: product.address,
        position: position.div(2),
        amount: amount.div(2),
        programs,
        feeAmount: feeAmount,
      })

      actionsUnwrapped = buildInvokerActions({
        userAddress: user.address,
        productAddress: product.address,
        position,
        amount,
        programs,
        vaultAddress: vault.address,
        vaultAmount,
        feeAmount: feeAmount,
        wrappedFee: false,
      })
    })

    it('does nothing on NOOP', async () => {
      const { user, multiInvoker } = instanceVars

      const tx = await multiInvoker.connect(user).invoke([actions.NOOP])
      const receipt = await tx.wait()
      expect(receipt.status).to.equal(1)
      expect(receipt.logs.length).to.equal(0)
    })

    it('calls the reserve directly if WRAP amount is greater than batcher balance', async () => {
      const { user, dsu, usdc, usdcHolder, multiInvoker, reserve } = instanceVars

      await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)

      const amount = utils.parseEther('2000000')
      const WRAP = {
        action: 8,
        args: utils.defaultAbiCoder.encode(['address', 'uint'], [user.address, amount]),
      }
      await expect(multiInvoker.connect(user).invoke([WRAP]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 2_000_000e6)
        .to.emit(reserve, 'Mint')
        .withArgs(multiInvoker.address, amount, 2_000_000e6)
        .to.emit(dsu, 'Transfer')
        .withArgs(reserve.address, multiInvoker.address, amount)
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvoker.address, user.address, amount)
    })

    it('performs a WRAP, DEPOSIT, and OPEN_MAKE chain', async () => {
      const { user, multiInvoker, batcher, collateral, usdc } = instanceVars

      await expect(multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a WRAP_AND_DEPOSIT and OPEN_MAKE chain', async () => {
      const { user, multiInvoker, batcher, collateral, usdc, dsu } = instanceVars

      // Ensure this works without a DSU aproval
      await dsu.connect(user).approve(multiInvoker.address, 0)

      await expect(multiInvoker.connect(user).invoke([actions.WRAP_AND_DEPOSIT, actions.OPEN_MAKE]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvoker.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a DEPOSIT and OPEN_MAKE chain', async () => {
      const { user, multiInvoker, collateral } = instanceVars

      await expect(multiInvoker.connect(user).invoke([actions.DEPOSIT, actions.OPEN_MAKE]))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
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
        .withArgs(user.address, INITIAL_VERSION + 4, position.div(2))
        .to.emit(collateral, 'Withdrawal')
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
        .withArgs(user.address, INITIAL_VERSION + 1, position.div(2))
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
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a WRAP_AND_DEPOSIT and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvoker, batcher, collateral, usdc, dsu } = instanceVars

      // Ensure this works without a DSU aproval
      await dsu.connect(user).approve(multiInvoker.address, 0)

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      await expect(multiInvoker.connect(user).invoke([actions.WRAP_AND_DEPOSIT, actions.OPEN_TAKE]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvoker.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a DEPOSIT and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvoker, collateral } = instanceVars

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      await expect(multiInvoker.connect(user).invoke([actions.DEPOSIT, actions.OPEN_TAKE]))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a CLOSE_TAKE and DEPOSIT chain', async () => {
      const { user, userB, multiInvoker, collateral, chainlink } = instanceVars

      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openMake(position)
      await multiInvoker.connect(user).invoke([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE])

      await chainlink.next()

      await expect(multiInvoker.connect(user).invoke([partialActions.CLOSE_TAKE, partialActions.DEPOSIT]))
        .to.emit(product, 'TakeClosed')
        .withArgs(user.address, INITIAL_VERSION + 1, position.div(2))
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
        .withArgs(user.address, INITIAL_VERSION + 4, position.div(2))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount.div(2))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, programs[0], '105752743484224563')
    })

    it('performs a WITHDRAW and UNWRAP chain', async () => {
      const { user, multiInvoker, batcher, usdc, collateral, reserve } = instanceVars

      // Load the Reserve with some USDC
      await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
      await batcher.connect(user).wrap(amount, user.address)
      await batcher.rebalance()

      // Deposit the collateral to withdraw
      await multiInvoker.connect(user).invoke([actions.DEPOSIT])

      await expect(multiInvoker.connect(user).invoke([actions.WITHDRAW, actions.UNWRAP]))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvoker.address, amount, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(reserve.address, multiInvoker.address, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(multiInvoker.address, user.address, 10000e6)
    })

    it(`sends unwrapped USDC in CHARGE_FEE action`, async () => {
      const { user, multiInvoker, dsu, usdc } = instanceVars

      expect(await usdc.balanceOf(vault.address)).to.eq('0')

      await expect(multiInvoker.connect(user).invoke([actions.WRAP, actionsUnwrapped.CHARGE_FEE])).to.not.be.reverted

      expect(await usdc.balanceOf(vault.address)).to.eq(10e6)
    })

    it(`wraps USDC to DSU on WRAP action and invokes CHARGE_FEE to interface`, async () => {
      const { user, multiInvoker, usdc, dsu } = instanceVars

      // // set
      // await multiInvoker.connect(user).invoke([actionsUnwrapped.WRAP, actionsUnwrapped.UNWRAP])

      await expect(multiInvoker.connect(user).invoke([actions.CHARGE_FEE])).to.not.be.reverted

      expect(await dsu.balanceOf(vault.address)).to.eq(utils.parseEther('10'))
    })

    it('performs WITHDRAW_AND_UNWRAP', async () => {
      const { user, multiInvoker, batcher, usdc, collateral, reserve, dsu } = instanceVars

      // Load the Reserve with some USDC
      await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
      await batcher.connect(user).wrap(amount, user.address)
      await batcher.rebalance()

      // Deposit the collateral to withdraw
      await multiInvoker.connect(user).invoke([actions.DEPOSIT])

      // Ensure this works without a DSU aproval
      await dsu.connect(user).approve(multiInvoker.address, 0)

      await expect(multiInvoker.connect(user).invoke([actions.WITHDRAW_AND_UNWRAP]))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvoker.address, amount, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(reserve.address, multiInvoker.address, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(multiInvoker.address, user.address, 10000e6)
    })

    it('performs WITHDRAW_AND_UNWRAP with max uint256', async () => {
      const { user, multiInvoker, batcher, usdc, collateral, reserve, dsu } = instanceVars

      // Load the Reserve with some USDC
      await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
      await batcher.connect(user).wrap(amount, user.address)
      await batcher.rebalance()

      // Deposit the collateral to withdraw
      await multiInvoker.connect(user).invoke([actions.DEPOSIT])

      // Ensure this works without a DSU aproval
      await dsu.connect(user).approve(multiInvoker.address, 0)

      const maxActions = buildInvokerActions({
        userAddress: user.address,
        productAddress: product.address,
        position,
        amount: constants.MaxUint256,
        programs,
        vaultAddress: vault.address,
        vaultAmount,
        feeAmount: feeAmount,
      })
      await expect(multiInvoker.connect(user).invoke([maxActions.WITHDRAW_AND_UNWRAP]))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvoker.address, amount, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(reserve.address, multiInvoker.address, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(multiInvoker.address, user.address, 10000e6)
    })

    it('Skips the reserve if batcher has enough USDC deposits', async () => {
      const { user, multiInvoker, batcher, usdc, usdcHolder } = instanceVars

      // Deposit USDC into the Batcher
      const twowayiface = new utils.Interface(['function deposit(uint256)'])
      await usdc.connect(usdcHolder).approve(batcher.address, constants.MaxUint256)
      await usdcHolder.sendTransaction({
        to: batcher.address,
        value: 0,
        data: twowayiface.encodeFunctionData('deposit', [utils.parseEther('20000')]),
      })

      await expect(multiInvoker.connect(user).invoke([actions.UNWRAP]))
        .to.emit(batcher, 'Unwrap')
        .withArgs(user.address, amount)
        .to.emit(usdc, 'Transfer')
        .withArgs(batcher.address, user.address, 10000e6)
    })

    it('performs a WRAP and VAULT_DEPOSIT chain', async () => {
      const { user, multiInvoker, dsu, batcher } = instanceVars

      await expect(multiInvoker.connect(user).invoke([actions.WRAP, actions.VAULT_DEPOSIT]))
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(dsu, 'Transfer')
        .withArgs(user.address, multiInvoker.address, vaultAmount)
        .to.emit(dsu, 'Approval')
        .withArgs(multiInvoker.address, vault.address, vaultAmount)
        .to.emit(vault, 'Deposit')
        .withArgs(multiInvoker.address, user.address, 1, vaultAmount)

      expect(await vault.balanceOf(user.address)).to.equal(vaultAmount)
      expect(await vault.claimable(user.address)).to.equal(0)
    })

    it('performs a VAULT_REDEEM action', async () => {
      const { user, multiInvoker } = instanceVars

      await expect(multiInvoker.connect(user).invoke([actions.VAULT_DEPOSIT, actions.VAULT_REDEEM]))
        .to.emit(vault, 'Redemption')
        .withArgs(multiInvoker.address, user.address, 1, vaultAmount)

      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.claimable(user.address)).to.equal(vaultAmount)
    })

    it('performs a VAULT_CLAIM and UNWRAP chain', async () => {
      const { user, multiInvoker, dsu, reserve } = instanceVars

      await expect(
        multiInvoker
          .connect(user)
          .invoke([actions.VAULT_DEPOSIT, actions.VAULT_REDEEM, actions.VAULT_CLAIM, actions.UNWRAP]),
      )
        .to.emit(dsu, 'Transfer')
        .withArgs(vault.address, user.address, vaultAmount)
        .to.emit(vault, 'Claim')
        .withArgs(multiInvoker.address, user.address, vaultAmount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvoker.address, amount, 10000e6)

      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.claimable(user.address)).to.equal(0)
    })

    it('performs a VAULT_WRAP_AND_DEPOSIT action', async () => {
      const { user, multiInvoker, dsu, usdc, batcher } = instanceVars

      // Ensure this works without a DSU aproval
      await dsu.connect(user).approve(multiInvoker.address, 0)

      await expect(multiInvoker.connect(user).invoke([actions.VAULT_WRAP_AND_DEPOSIT]))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvoker.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvoker.address, amount)
        .to.emit(dsu, 'Approval')
        .withArgs(multiInvoker.address, vault.address, vaultAmount)
        .to.emit(vault, 'Deposit')
        .withArgs(multiInvoker.address, user.address, 1, vaultAmount)

      expect(await vault.balanceOf(user.address)).to.equal(vaultAmount)
      expect(await vault.claimable(user.address)).to.equal(0)
    })

    context('0 address batcher', () => {
      beforeEach(async () => {
        const { usdc, reserve, controller, multiInvoker, owner, proxyAdmin } = instanceVars
        const multiInvokerImpl = await new MultiInvoker__factory(owner).deploy(
          usdc.address,
          constants.AddressZero,
          reserve.address,
          controller.address,
        )

        await proxyAdmin.upgrade(multiInvoker.address, multiInvokerImpl.address)
      })

      it('calls the reserve directly on WRAP', async () => {
        const { user, dsu, usdc, usdcHolder, multiInvoker, reserve } = instanceVars

        await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)

        const amount = utils.parseEther('2000000')
        const WRAP = {
          action: 8,
          args: utils.defaultAbiCoder.encode(['address', 'uint'], [user.address, amount]),
        }
        await expect(multiInvoker.connect(user).invoke([WRAP]))
          .to.emit(usdc, 'Transfer')
          .withArgs(user.address, multiInvoker.address, 2_000_000e6)
          .to.emit(reserve, 'Mint')
          .withArgs(multiInvoker.address, amount, 2_000_000e6)
          .to.emit(dsu, 'Transfer')
          .withArgs(reserve.address, multiInvoker.address, amount)
          .to.emit(dsu, 'Transfer')
          .withArgs(multiInvoker.address, user.address, amount)
      })

      it('calls the reserve directly on UNWRAP', async () => {
        const { user, multiInvoker, batcher, usdc, reserve } = instanceVars

        // Load the Reserve with some USDC
        await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
        await batcher.connect(user).wrap(amount, user.address)
        await batcher.rebalance()

        await expect(multiInvoker.connect(user).invoke([actions.UNWRAP]))
          .to.emit(reserve, 'Redeem')
          .withArgs(multiInvoker.address, amount, 10000e6)
          .to.emit(usdc, 'Transfer')
          .withArgs(reserve.address, multiInvoker.address, 10000e6)
          .to.emit(usdc, 'Transfer')
          .withArgs(multiInvoker.address, user.address, 10000e6)
      })
    })
  })
})

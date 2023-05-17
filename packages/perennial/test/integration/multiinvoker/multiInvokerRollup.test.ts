import { TransactionRequest } from '@ethersproject/abstract-provider'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, BigNumberish, constants, utils } from 'ethers'
import {
  MultiInvokerRollup__factory,
  Product,
  TestnetVault,
  TestnetVault__factory,
  MultiInvokerRollup,
} from '../../../types/generated'
import { IMultiInvokerRollup } from '../../../types/generated/contracts/interfaces/IMultiInvokerRollup'
import { buildInvokerActions, InvokerAction, buildInvokerActionRollup, buildAllActionsRollup } from '../../util'

import {
  InstanceVars,
  deployProtocol,
  createProduct,
  createIncentiveProgram,
  depositTo,
  INITIAL_VERSION,
} from '../helpers/setupHelpers'

describe('MultiInvokerRollup', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
    instanceVars.controller.updateMultiInvoker(instanceVars.multiInvokerRollup.address)
  })

  describe('#initialize', () => {
    it('sets the correct contract addresses', async () => {
      const { multiInvokerRollup, usdc, dsu, batcher, controller, collateral, reserve } = instanceVars

      expect((await multiInvokerRollup.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
      expect((await multiInvokerRollup.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
      expect((await multiInvokerRollup.batcher()).toLowerCase()).to.equal(batcher.address.toLowerCase())
      expect((await multiInvokerRollup.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
      expect((await multiInvokerRollup.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
      expect((await multiInvokerRollup.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
    })

    it('sets the correct approvals', async () => {
      const { multiInvokerRollup, usdc, dsu, batcher, collateral, reserve } = instanceVars

      expect(await dsu.allowance(multiInvokerRollup.address, collateral.address)).to.equal(constants.MaxUint256)
      expect(await dsu.allowance(multiInvokerRollup.address, batcher.address)).to.equal(constants.MaxUint256)
      expect(await dsu.allowance(multiInvokerRollup.address, reserve.address)).to.equal(constants.MaxUint256)
      expect(await usdc.allowance(multiInvokerRollup.address, batcher.address)).to.equal(constants.MaxUint256)
      expect(await usdc.allowance(multiInvokerRollup.address, reserve.address)).to.equal(constants.MaxUint256)
    })

    it('reverts if already initialized', async () => {
      await expect(instanceVars.multiInvokerRollup.initialize())
        .to.be.revertedWithCustomError(instanceVars.multiInvokerRollup, 'UInitializableAlreadyInitializedError')
        .withArgs(2)
    })
  })

  describe('common chains', async () => {
    let product: Product
    let actions: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
    let partialActions: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
    let customActions: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
    let position: BigNumber
    let amount: BigNumber
    let programs: number[]
    let vault: TestnetVault
    let vaultAmount: BigNumber

    beforeEach(async () => {
      const { owner, user, dsu, usdc, usdcHolder, multiInvokerRollup } = instanceVars
      await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)
      await usdc.connect(user).approve(multiInvokerRollup.address, constants.MaxUint256)
      await dsu.connect(user).approve(multiInvokerRollup.address, constants.MaxUint256)

      product = await createProduct(instanceVars)
      const PROGRAM_ID = await createIncentiveProgram(instanceVars, product)
      vault = await new TestnetVault__factory(owner).deploy(dsu.address)
      await vault._incrementVersion()

      position = utils.parseEther('0.001')
      amount = utils.parseEther('10000')
      const feeAmount = utils.parseEther('10')
      programs = [PROGRAM_ID.toNumber()]
      vaultAmount = amount
      actions = buildInvokerActionRollup(
        BigNumber.from(0),
        BigNumber.from(0),
        BigNumber.from(0),
        user.address,
        product.address,
        vault.address,
        position,
        amount,
        vaultAmount,
        feeAmount,
        true,
        programs,
      )

      partialActions = buildInvokerActionRollup(
        BigNumber.from(0),
        BigNumber.from(0),
        BigNumber.from(0),
        user.address,
        product.address,
        vault.address,
        position.div(2),
        amount.div(2),
        vaultAmount,
        feeAmount,
        false,
        programs,
      )

      customActions = buildInvokerActionRollup(
        BigNumber.from(0),
        BigNumber.from(0),
        BigNumber.from(0),
        user.address,
        product.address,
        vault.address,
        position,
        utils.parseEther('2000000'),
        vaultAmount,
        feeAmount,
        false,
        programs,
      )
    })

    it('does nothing on NOOP', async () => {
      const { user, multiInvokerRollup } = instanceVars

      await expect(await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.NOOP.payload)))
        .to.not.be.reverted

      //   const receipt = await tx.wait()
      //   expect(receipt.status).to.equal(1)
      //   expect(receipt.logs.length).to.equal(0)
    })

    it('calls the reserve directly if WRAP amount is greater than batcher balance', async () => {
      const { user, dsu, usdc, usdcHolder, multiInvokerRollup, reserve } = instanceVars

      await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)

      await expect(
        await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, customActions.WRAP.payload)),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, 2_000_000e6)
        .to.emit(reserve, 'Mint')
        .withArgs(multiInvokerRollup.address, utils.parseEther('2000000'), 2_000_000e6)
        .to.emit(dsu, 'Transfer')
        .withArgs(reserve.address, multiInvokerRollup.address, utils.parseEther('2000000'))
        .to.emit(dsu, 'Transfer')
        .withArgs(multiInvokerRollup.address, user.address, utils.parseEther('2000000'))
    })

    it('performs a WRAP, DEPOSIT, and OPEN_MAKE chain', async () => {
      const { user, multiInvokerRollup, batcher, collateral, usdc } = instanceVars

      const payload = buildAllActionsRollup(Object.values([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a WRAP_AND_DEPOSIT and OPEN_MAKE chain', async () => {
      const { user, multiInvokerRollup, batcher, collateral, usdc } = instanceVars

      const payload = buildAllActionsRollup(Object.values([actions.WRAP_AND_DEPOSIT, actions.OPEN_MAKE]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvokerRollup.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a DEPOSIT and OPEN_MAKE chain', async () => {
      const { user, multiInvokerRollup, collateral } = instanceVars

      const payload = buildAllActionsRollup(Object.values([actions.DEPOSIT, actions.OPEN_MAKE]))

      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload))

      await expect(res)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'MakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a CLOSE_MAKE, WITHDRAW, and CLAIM chain', async () => {
      const { user, userB, multiInvokerRollup, incentivizer, chainlink, collateral } = instanceVars

      const payload1 = buildAllActionsRollup(Object.values([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE]))

      const res1 = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload1))

      await expect(res1).to.not.be.reverted
      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openTake(position.div(2))

      await chainlink.next()
      await product.settle()

      await chainlink.next()
      await chainlink.next()
      await chainlink.next()
      await product.settle()

      await product.connect(userB).closeTake(position.div(2))

      const payload2 = buildAllActionsRollup(
        Object.values([partialActions.CLOSE_MAKE, partialActions.WITHDRAW, actions.CLAIM]),
      )

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload2)))
        .to.emit(product, 'MakeClosed')
        .withArgs(user.address, INITIAL_VERSION + 4, position.div(2))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount.div(2))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, programs[0], '423010973936898252')
    })

    it('performs a CLOSE_MAKE and DEPOSIT', async () => {
      const { user, multiInvokerRollup, chainlink, collateral } = instanceVars

      const payload = buildAllActionsRollup(Object.values([actions.WRAP, actions.DEPOSIT, actions.OPEN_MAKE]))

      await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload))

      await chainlink.next()

      const payload2 = buildAllActionsRollup(Object.values([partialActions.CLOSE_MAKE, partialActions.DEPOSIT]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload2)))
        .to.emit(product, 'MakeClosed')
        .withArgs(user.address, INITIAL_VERSION + 1, position.div(2))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount.div(2))
    })

    it('performs a WRAP, DEPOSIT, and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvokerRollup, batcher, collateral, usdc } = instanceVars

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      const payload = buildAllActionsRollup(Object.values([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a WRAP_AND_DEPOSIT and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvokerRollup, batcher, collateral, usdc } = instanceVars

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      const payload = buildAllActionsRollup(Object.values([actions.WRAP_AND_DEPOSIT, actions.OPEN_TAKE]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvokerRollup.address, amount)
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a DEPOSIT and OPEN_TAKE chain', async () => {
      const { user, userB, multiInvokerRollup, collateral } = instanceVars

      await depositTo(instanceVars, userB, product, amount.mul(2))
      await product.connect(userB).openMake(position.mul(2))

      const payload = buildAllActionsRollup(Object.values([actions.DEPOSIT, actions.OPEN_TAKE]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount)
        .to.emit(product, 'TakeOpened')
        .withArgs(user.address, INITIAL_VERSION, position)
    })

    it('performs a CLOSE_TAKE and DEPOSIT chain', async () => {
      const { user, userB, multiInvokerRollup, collateral, chainlink } = instanceVars

      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openMake(position)

      const payload = buildAllActionsRollup(Object.values([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE]))
      await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload))

      await chainlink.next()

      const payload2 = buildAllActionsRollup(Object.values([partialActions.CLOSE_TAKE, partialActions.DEPOSIT]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload2)))
        .to.emit(product, 'TakeClosed')
        .withArgs(user.address, INITIAL_VERSION + 1, position.div(2))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, amount.div(2))
    })

    it('performs a CLOSE_TAKE, WITHDRAW, and CLAIM chain', async () => {
      const { user, userB, multiInvokerRollup, incentivizer, collateral, chainlink } = instanceVars

      await depositTo(instanceVars, userB, product, amount)
      await product.connect(userB).openMake(position)

      const payload = buildAllActionsRollup(Object.values([actions.WRAP, actions.DEPOSIT, actions.OPEN_TAKE]))
      await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload))

      await chainlink.next()
      await product.settle()

      await chainlink.next()
      await chainlink.next()
      await chainlink.next()
      await product.settle()

      const payload2 = buildAllActionsRollup(
        Object.values([partialActions.CLOSE_TAKE, partialActions.WITHDRAW, actions.CLAIM]),
      )

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload2)))
        .to.emit(product, 'TakeClosed')
        .withArgs(user.address, INITIAL_VERSION + 4, position.div(2))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount.div(2))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, programs[0], '105752743484224563')
    })

    it('performs a WITHDRAW and UNWRAP chain', async () => {
      const { user, multiInvokerRollup, batcher, usdc, collateral, reserve } = instanceVars

      // Load the Reserve with some USDC
      await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
      await batcher.connect(user).wrap(amount, user.address)
      await batcher.rebalance()

      // Deposit the collateral to withdraw
      await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.DEPOSIT.payload))

      const payload = buildAllActionsRollup(Object.values([actions.WITHDRAW, actions.UNWRAP]))
      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvokerRollup.address, amount, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(reserve.address, multiInvokerRollup.address, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(multiInvokerRollup.address, user.address, 10000e6)
    })

    it(`sends unwrapped USDC in CHARGE_FEE action`, async () => {
      const { user, multiInvokerRollup, dsu, usdc } = instanceVars

      expect(await usdc.balanceOf(vault.address)).to.eq('0')

      const res = user.sendTransaction(
        buildTransactionRequest(
          user,
          multiInvokerRollup,
          actions.WRAP.payload + customActions.CHARGE_FEE.payload.substring(4),
        ),
      )

      await expect(res).to.not.be.reverted

      expect(await usdc.balanceOf(vault.address)).to.eq(10e6)
    })

    it(`wraps USDC to DSU on WRAP action and invokes CHARGE_FEE to interface `, async () => {
      const { user, multiInvokerRollup, usdc, dsu } = instanceVars

      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.CHARGE_FEE.payload))

      await expect(res).to.not.be.reverted
      expect(await dsu.balanceOf(vault.address)).to.eq(utils.parseEther('10'))
    })

    it('performs WITHDRAW_AND_UNWRAP', async () => {
      const { user, multiInvokerRollup, batcher, usdc, collateral, reserve } = instanceVars

      // Load the Reserve with some USDC
      await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
      await batcher.connect(user).wrap(amount, user.address)
      await batcher.rebalance()

      // Deposit the collateral to withdraw
      await user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.DEPOSIT.payload))

      await expect(
        user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.WITHDRAW_AND_UNWRAP.payload)),
      )
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, product.address, amount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvokerRollup.address, amount, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(reserve.address, multiInvokerRollup.address, 10000e6)
        .to.emit(usdc, 'Transfer')
        .withArgs(multiInvokerRollup.address, user.address, 10000e6)
    })

    it('Skips the reserve if batcher has enough USDC deposits', async () => {
      const { user, multiInvokerRollup, batcher, usdc, usdcHolder } = instanceVars

      // Deposit USDC into the Batcher
      const twowayiface = new utils.Interface(['function deposit(uint256)'])
      await usdc.connect(usdcHolder).approve(batcher.address, constants.MaxUint256)
      await usdcHolder.sendTransaction({
        to: batcher.address,
        value: 0,
        data: twowayiface.encodeFunctionData('deposit', [utils.parseEther('20000')]),
      })

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.UNWRAP.payload)))
        .to.emit(batcher, 'Unwrap')
        .withArgs(user.address, amount)
        .to.emit(usdc, 'Transfer')
        .withArgs(batcher.address, user.address, 10000e6)
    })

    it('performs a WRAP and VAULT_DEPOSIT chain', async () => {
      const { user, multiInvokerRollup, dsu, batcher } = instanceVars

      const payload = buildAllActionsRollup(Object.values([actions.WRAP, actions.VAULT_DEPOSIT]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(batcher, 'Wrap')
        .withArgs(user.address, amount)
        .to.emit(dsu, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, vaultAmount)
        .to.emit(dsu, 'Approval')
        .withArgs(multiInvokerRollup.address, vault.address, vaultAmount)
        .to.emit(vault, 'Deposit')
        .withArgs(multiInvokerRollup.address, user.address, 1, vaultAmount)

      expect(await vault.balanceOf(user.address)).to.equal(vaultAmount)
      expect(await vault.claimable(user.address)).to.equal(0)
    })

    it('performs a VAULT_REDEEM action', async () => {
      const { user, multiInvokerRollup } = instanceVars

      const payload = buildAllActionsRollup(Object.values([actions.VAULT_DEPOSIT, actions.VAULT_REDEEM]))

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(vault, 'Redemption')
        .withArgs(multiInvokerRollup.address, user.address, 1, vaultAmount)

      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.claimable(user.address)).to.equal(vaultAmount)
    })

    it('performs a VAULT_CLAIM and UNWRAP chain', async () => {
      const { user, multiInvokerRollup, dsu, reserve } = instanceVars

      const payload = buildAllActionsRollup(
        Object.values([actions.VAULT_DEPOSIT, actions.VAULT_REDEEM, actions.VAULT_CLAIM, actions.UNWRAP]),
      )

      await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, payload)))
        .to.emit(dsu, 'Transfer')
        .withArgs(vault.address, user.address, vaultAmount)
        .to.emit(vault, 'Claim')
        .withArgs(multiInvokerRollup.address, user.address, vaultAmount)
        .to.emit(reserve, 'Redeem')
        .withArgs(multiInvokerRollup.address, amount, 10000e6)

      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.claimable(user.address)).to.equal(0)
    })

    it('performs a VAULT_WRAP_AND_DEPOSIT action', async () => {
      const { user, multiInvokerRollup, dsu, usdc, batcher } = instanceVars

      await expect(
        user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.VAULT_WRAP_AND_DEPOSIT.payload)),
      )
        .to.emit(usdc, 'Transfer')
        .withArgs(user.address, multiInvokerRollup.address, 10000e6)
        .to.emit(batcher, 'Wrap')
        .withArgs(multiInvokerRollup.address, amount)
        .to.emit(dsu, 'Approval')
        .withArgs(multiInvokerRollup.address, vault.address, vaultAmount)
        .to.emit(vault, 'Deposit')
        .withArgs(multiInvokerRollup.address, user.address, 1, vaultAmount)

      expect(await vault.balanceOf(user.address)).to.equal(vaultAmount)
      expect(await vault.claimable(user.address)).to.equal(0)
    })

    context('0 address batcher', () => {
      beforeEach(async () => {
        const { usdc, reserve, controller, multiInvokerRollup, owner, proxyAdmin } = instanceVars
        const multiInvokerImpl = await new MultiInvokerRollup__factory(owner).deploy(
          usdc.address,
          constants.AddressZero,
          reserve.address,
          controller.address,
        )

        await proxyAdmin.upgrade(multiInvokerRollup.address, multiInvokerImpl.address)
      })

      it('calls the reserve directly on WRAP', async () => {
        const { user, dsu, usdc, usdcHolder, multiInvokerRollup, reserve } = instanceVars

        await usdc.connect(usdcHolder).transfer(user.address, 1_000_000e6)

        await expect(
          user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, customActions.WRAP.payload)),
        )
          .to.emit(usdc, 'Transfer')
          .withArgs(user.address, multiInvokerRollup.address, 2_000_000e6)
          .to.emit(reserve, 'Mint')
          .withArgs(multiInvokerRollup.address, utils.parseEther('2000000'), 2_000_000e6)
          .to.emit(dsu, 'Transfer')
          .withArgs(reserve.address, multiInvokerRollup.address, utils.parseEther('2000000'))
          .to.emit(dsu, 'Transfer')
          .withArgs(multiInvokerRollup.address, user.address, utils.parseEther('2000000'))
      })

      it('calls the reserve directly on UNWRAP', async () => {
        const { user, multiInvokerRollup, batcher, usdc, reserve } = instanceVars

        // Load the Reserve with some USDC
        await usdc.connect(user).approve(batcher.address, constants.MaxUint256)
        await batcher.connect(user).wrap(amount, user.address)
        await batcher.rebalance()

        await expect(user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, actions.UNWRAP.payload)))
          .to.emit(reserve, 'Redeem')
          .withArgs(multiInvokerRollup.address, amount, 10000e6)
          .to.emit(usdc, 'Transfer')
          .withArgs(reserve.address, multiInvokerRollup.address, 10000e6)
          .to.emit(usdc, 'Transfer')
          .withArgs(multiInvokerRollup.address, user.address, 10000e6)
      })
    })
  })
})

export function buildTransactionRequest(
  user: SignerWithAddress,
  invoker: MultiInvokerRollup,
  payload: string,
): TransactionRequest {
  const txn: TransactionRequest = {
    from: user.address,
    to: invoker.address,
    data: payload,
    //gasLimit: 2e,
  }
  return txn
}

import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { assert, expect, use } from 'chai'
import HRE from 'hardhat'
import { BigNumber, BigNumberish, constants, utils } from 'ethers'

import {
  ICollateral,
  IController,
  IERC20,
  MultiInvokerRollup,
  MultiInvokerRollup__factory,
  IProduct,
  IIncentivizer,
  IEmptySetReserve,
  IBatcher,
} from '../../../types/generated'
import { IMultiInvokerRollup } from '../../../types/generated/contracts/interfaces/IMultiInvokerRollup'
import { InvokerAction, buildInvokerActionRollup, buildAllActionsRollup } from '../../util'
import { TransactionRequest } from '@ethersproject/abstract-provider'

const { ethers } = HRE
use(smock.matchers)

describe('MultiInvokerRollup', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let usdc: FakeContract<IERC20>
  let dsu: FakeContract<IERC20>
  let product: FakeContract<IProduct>
  let collateral: FakeContract<ICollateral>
  let controller: FakeContract<IController>
  let batcher: FakeContract<IBatcher>
  let incentivizer: FakeContract<IIncentivizer>
  let reserve: FakeContract<IEmptySetReserve>
  let multiInvokerRollup: MultiInvokerRollup

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    usdc = await smock.fake<IERC20>('IERC20')
    dsu = await smock.fake<IERC20>('IERC20')
    collateral = await smock.fake<ICollateral>('ICollateral')
    batcher = await smock.fake<IBatcher>('Batcher')
    controller = await smock.fake<IController>('IController')
    incentivizer = await smock.fake<IIncentivizer>('IIncentivizer')
    product = await smock.fake<IProduct>('IProduct')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')

    controller.collateral.returns(collateral.address)
    controller.incentivizer.returns(incentivizer.address)
    collateral.token.returns(dsu.address)
    batcher.DSU.returns(dsu.address)

    multiInvokerRollup = await new MultiInvokerRollup__factory(owner).deploy(
      usdc.address,
      batcher.address,
      reserve.address,
      controller.address,
    )

    dsu.allowance.whenCalledWith(multiInvokerRollup.address, collateral.address).returns(0)
    dsu.approve.whenCalledWith(collateral.address, 0).returns(true)
    dsu.approve.whenCalledWith(collateral.address, ethers.constants.MaxUint256).returns(true)

    dsu.allowance.whenCalledWith(multiInvokerRollup.address, batcher.address).returns(0)
    dsu.approve.whenCalledWith(batcher.address, 0).returns(true)
    dsu.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)

    dsu.allowance.whenCalledWith(multiInvokerRollup.address, reserve.address).returns(0)
    dsu.approve.whenCalledWith(reserve.address, 0).returns(true)
    dsu.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)
    dsu.balanceOf.whenCalledWith(batcher.address).returns(constants.MaxUint256)

    dsu.transferFrom.returns(true)

    usdc.allowance.whenCalledWith(multiInvokerRollup.address, batcher.address).returns(0)
    usdc.approve.whenCalledWith(batcher.address, 0).returns(true)
    usdc.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)

    usdc.allowance.whenCalledWith(multiInvokerRollup.address, reserve.address).returns(0)
    usdc.approve.whenCalledWith(reserve.address, 0).returns(true)
    usdc.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)
    usdc.balanceOf.whenCalledWith(batcher.address).returns(1_000_000e6)

    await multiInvokerRollup.initialize()
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect((await multiInvokerRollup.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
      expect((await multiInvokerRollup.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
      expect((await multiInvokerRollup.batcher()).toLowerCase()).to.equal(batcher.address.toLowerCase())
      expect((await multiInvokerRollup.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
      expect((await multiInvokerRollup.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
      expect((await multiInvokerRollup.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
    })
  })

  describe('#initialize', () => {
    it('initializes correctly', async () => {
      expect(dsu.approve).to.be.calledWith(collateral.address, ethers.constants.MaxUint256)
      expect(dsu.approve).to.be.calledWith(batcher.address, ethers.constants.MaxUint256)
      expect(dsu.approve).to.be.calledWith(reserve.address, ethers.constants.MaxUint256)
      expect(usdc.approve).to.be.calledWith(batcher.address, ethers.constants.MaxUint256)
      expect(usdc.approve).to.be.calledWith(reserve.address, ethers.constants.MaxUint256)
    })
  })

  describe('#invoke', () => {
    let actions: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
    const amount = utils.parseEther('100')
    const usdcAmount = 100e6
    const position = utils.parseEther('12')
    const programs = [1, 2, 3]

    beforeEach(() => {
      actions = buildInvokerActionRollup(
        BigNumber.from(0),
        BigNumber.from(0),
        user.address,
        product.address,
        position,
        amount,
        programs,
      )
      dsu.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, amount).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, usdcAmount).returns(true)
      usdc.transfer.whenCalledWith(user.address, usdcAmount).returns(true)
    })

    it('does nothing on NOOP action', async () => {
      await expect(multiInvokerRollup.connect(user)).to.not.be.reverted
    })

    it('deposits on DEPOSIT action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.DEPOSIT.payload),
      )

      await expect(res).to.not.be.reverted
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
    })

    it('withdraws on WITHDRAW action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WITHDRAW.payload),
      )

      await expect(res).to.not.be.reverted
      expect(collateral.withdrawFrom).to.have.been.calledWith(user.address, user.address, product.address, amount)
    })

    it('opens a take position on OPEN_TAKE action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.OPEN_TAKE.payload),
      )

      await expect(res).to.not.be.reverted
      expect(product.openTakeFor).to.have.been.calledWith(user.address, position)
    })

    it('closes a take position on CLOSE_TAKE action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.CLOSE_TAKE.payload),
      )

      await expect(res).to.not.be.reverted
      expect(product.closeTakeFor).to.have.been.calledWith(user.address, position)
    })

    it('opens a make position on OPEN_MAKE action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.OPEN_MAKE.payload),
      )

      await expect(res).to.not.be.reverted
      expect(product.openMakeFor).to.have.been.calledWith(user.address, position)
    })

    it('closes a make position on CLOSE_MAKE action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.CLOSE_MAKE.payload),
      )

      await expect(res).to.not.be.reverted
      expect(product.closeMakeFor).to.have.been.calledWith(user.address, position)
    })

    it('claims incentive rewards on CLAIM action', async () => {
      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.CLAIM.payload))

      await expect(res).to.not.be.reverted
      expect(incentivizer.claimFor).to.have.been.calledWith(user.address, product.address, programs)
    })

    it('wraps USDC to DSU on WRAP action', async () => {
      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WRAP.payload))

      await expect(res).to.not.be.reverted
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, usdcAmount)
      expect(batcher.wrap).to.have.been.calledWith(amount, user.address)
    })

    it('wraps USDC to DSU using RESERVE on WRAP action if amount is greater than batcher balance', async () => {
      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)
      dsu.transfer.whenCalledWith(user.address, amount).returns(true)

      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WRAP.payload))

      await expect(res).to.not.be.reverted
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, usdcAmount)
      expect(reserve.mint).to.have.been.calledWith(amount)
      expect(dsu.transfer).to.have.been.calledWith(user.address, amount)
    })

    it('unwraps DSU to USDC on UNWRAP action', async () => {
      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.UNWRAP.payload))

      await expect(res).to.not.be.reverted
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)
    })

    it('unwraps DSU to USDC using RESERVE on UNWRAP action if amount is greater than batcher balance', async () => {
      usdc.balanceOf.whenCalledWith(batcher.address).returns(0)
      usdc.transfer.whenCalledWith(user.address, amount).returns(true)

      const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.UNWRAP.payload))

      await expect(res).to.not.be.reverted
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
      expect(reserve.redeem).to.have.been.calledWith(amount)
      expect(usdc.transfer).to.have.been.calledWith(user.address, usdcAmount)
    })

    it('wraps USDC to DSU then deposits DSU on WRAP_AND_DEPOSIT action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WRAP_AND_DEPOSIT.payload),
      )

      await expect(res).to.not.be.reverted
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, usdcAmount)
      expect(batcher.wrap).to.have.been.calledWith(amount, multiInvokerRollup.address)
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
    })

    it('wraps USDC to DSU using RESERVE then deposits DSU on WRAP_AND_DEPOSIT action if amount is greater than batcher balance', async () => {
      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)
      dsu.transfer.whenCalledWith(multiInvokerRollup.address, amount).returns(true)

      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WRAP_AND_DEPOSIT.payload),
      )

      await expect(res).to.not.be.reverted
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, usdcAmount)
      expect(reserve.mint).to.have.been.calledWith(amount)
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
    })

    it('withdraws then unwraps DSU to USDC on WITHDRAW_AND_UNWRAP action', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WITHDRAW_AND_UNWRAP.payload),
      )

      await expect(res).to.not.be.reverted
      expect(collateral.withdrawFrom).to.have.been.calledWith(
        user.address,
        multiInvokerRollup.address,
        product.address,
        amount,
      )

      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)
    })

    it('withdraws then unwraps DSU to USDC using RESERVE on WITHDRAW_AND_UNWRAP action if amount is greater than batcher balance', async () => {
      usdc.balanceOf.whenCalledWith(batcher.address).returns(0)

      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WITHDRAW_AND_UNWRAP.payload),
      )

      await expect(res).to.not.be.reverted
      expect(collateral.withdrawFrom).to.have.been.calledWith(
        user.address,
        multiInvokerRollup.address,
        product.address,
        amount,
      )

      expect(reserve.redeem).to.have.been.calledWith(amount)
      expect(usdc.transfer).to.have.been.calledWith(user.address, usdcAmount)
    })

    it('performs a multi invoke', async () => {
      const res = user.sendTransaction(
        buildTransactionRequest(user, multiInvokerRollup, buildAllActionsRollup(Object.values(actions))),
      )

      await expect(res).to.not.be.reverted

      // Deposit/Withdraw
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
      expect(collateral.withdrawFrom).to.have.been.calledWith(user.address, user.address, product.address, amount)

      // Open/Close Positions
      expect(product.openTakeFor).to.have.been.calledWith(user.address, position)
      expect(product.closeTakeFor).to.have.been.calledWith(user.address, position)
      expect(product.openMakeFor).to.have.been.calledWith(user.address, position)
      expect(product.closeMakeFor).to.have.been.calledWith(user.address, position)

      // Claim
      expect(incentivizer.claimFor).to.have.been.calledWith(user.address, product.address, programs)

      // Wrap/Unwrap
      expect(batcher.wrap).to.have.been.calledWith(amount, user.address)
      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)

      // Underlying Transfers
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, usdcAmount)
    })
  })

  context('batcher address is 0', () => {
    beforeEach(async () => {
      multiInvokerRollup = await new MultiInvokerRollup__factory(owner).deploy(
        usdc.address,
        constants.AddressZero,
        reserve.address,
        controller.address,
      )

      dsu.allowance.whenCalledWith(multiInvokerRollup.address, collateral.address).returns(0)
      dsu.approve.whenCalledWith(collateral.address, ethers.constants.MaxUint256).returns(true)
      dsu.allowance.whenCalledWith(multiInvokerRollup.address, reserve.address).returns(0)
      dsu.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)

      usdc.allowance.whenCalledWith(multiInvokerRollup.address, reserve.address).returns(0)
      usdc.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)

      await multiInvokerRollup.initialize()
    })

    describe('#constructor', () => {
      it('constructs correctly', async () => {
        expect((await multiInvokerRollup.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
        expect((await multiInvokerRollup.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
        expect((await multiInvokerRollup.batcher()).toLowerCase()).to.equal(constants.AddressZero)
        expect((await multiInvokerRollup.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
        expect((await multiInvokerRollup.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
        expect((await multiInvokerRollup.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
      })
    })

    describe('#initialize', () => {
      it('initializes correctly', async () => {
        expect(dsu.approve).to.be.calledWith(collateral.address, ethers.constants.MaxUint256)
        expect(dsu.approve).to.be.calledWith(reserve.address, ethers.constants.MaxUint256)
        expect(usdc.approve).to.be.calledWith(reserve.address, ethers.constants.MaxUint256)
      })
    })

    describe('#invoke', () => {
      let actions: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
      const amount = utils.parseEther('100')
      const usdcAmount = 100e6
      const position = utils.parseEther('12')
      const programs = [1, 2, 3]

      beforeEach(() => {
        actions = buildInvokerActionRollup(
          BigNumber.from(0),
          BigNumber.from(0),
          user.address,
          product.address,
          position,
          amount,
          programs,
        )
        dsu.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, amount).returns(true)
        usdc.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, usdcAmount).returns(true)
        usdc.transfer.whenCalledWith(user.address, usdcAmount).returns(true)
      })

      it('wraps USDC to DSU using RESERVE on WRAP action', async () => {
        dsu.transfer.whenCalledWith(user.address, amount).returns(true)

        const res = user.sendTransaction(buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.WRAP.payload))

        await expect(res).to.not.be.reverted
        // multiInvokerRollup.connect(user).invoke([actions.WRAP])
        expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, usdcAmount)
        expect(reserve.mint).to.have.been.calledWith(amount)
        expect(dsu.transfer).to.have.been.calledWith(user.address, amount)
      })

      it('unwraps DSU to USDC using RESERVE on UNWRAP action', async () => {
        usdc.transfer.whenCalledWith(user.address, amount).returns(true)

        const res = user.sendTransaction(
          buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.UNWRAP.payload),
        )

        await expect(res).to.not.be.reverted

        expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
        expect(reserve.redeem).to.have.been.calledWith(amount)
        expect(usdc.transfer).to.have.been.calledWith(user.address, usdcAmount)
      })
    })
  })

  context('performs actions using cache', () => {
    describe('#constructor', () => {
      it('constructs correctly', async () => {
        expect((await multiInvokerRollup.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
        expect((await multiInvokerRollup.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
        expect((await multiInvokerRollup.batcher()).toLowerCase()).to.equal(batcher.address.toLowerCase())
        expect((await multiInvokerRollup.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
        expect((await multiInvokerRollup.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
        expect((await multiInvokerRollup.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
      })
    })

    describe('#initialize', () => {
      it('initializes correctly', async () => {
        expect(dsu.approve).to.be.calledWith(collateral.address, ethers.constants.MaxUint256)
        expect(dsu.approve).to.be.calledWith(batcher.address, ethers.constants.MaxUint256)
        expect(dsu.approve).to.be.calledWith(reserve.address, ethers.constants.MaxUint256)
        expect(usdc.approve).to.be.calledWith(batcher.address, ethers.constants.MaxUint256)
        expect(usdc.approve).to.be.calledWith(reserve.address, ethers.constants.MaxUint256)
      })
    })

    describe('#invoke', () => {
      let actions: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
      let actionsCached: { [action in InvokerAction]: { action: BigNumberish; payload: string } }
      const amount = utils.parseEther('50')
      const usdcAmount = 100e6
      const position = utils.parseEther('12')
      const programs = [1, 2, 3]

      beforeEach(() => {
        actions = buildInvokerActionRollup(
          BigNumber.from(0),
          BigNumber.from(0),
          user.address,
          product.address,
          position,
          amount,
          programs,
        )
        actionsCached = buildInvokerActionRollup(
          BigNumber.from(1),
          BigNumber.from(1),
          undefined,
          undefined,
          position,
          amount,
          programs,
        )

        dsu.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, amount).returns(true)
        usdc.transferFrom.whenCalledWith(user.address, multiInvokerRollup.address, usdcAmount).returns(true)
        usdc.transfer.whenCalledWith(user.address, usdcAmount).returns(true)
      })

      it('performs cached invoke on DEPOSIT', async () => {
        // 1) set state caching
        let res = user.sendTransaction(
          buildTransactionRequest(user, multiInvokerRollup, '0x' + actions.DEPOSIT.payload),
        )

        await expect(res).to.not.be.reverted
        expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
        expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)

        // assert caches set in 1st txn
        expect(await multiInvokerRollup.connect(user).userNonces(user.address)).to.eq(1)
        expect(await multiInvokerRollup.connect(user).productNonces(product.address)).to.eq(1)

        // 2) call contract with cached payload
        res = user.sendTransaction(
          buildTransactionRequest(user, multiInvokerRollup, '0x' + actionsCached.DEPOSIT.payload),
        )

        await expect(res).to.not.be.reverted
        expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvokerRollup.address, amount)
        expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
      })
    })
  })
})

function buildTransactionRequest(
  user: SignerWithAddress,
  invoker: MultiInvokerRollup,
  payload: string,
): TransactionRequest {
  const txn: TransactionRequest = {
    from: user.address,
    to: invoker.address,
    data: payload,
    gasLimit: 2.5e7,
  }
  return txn
}

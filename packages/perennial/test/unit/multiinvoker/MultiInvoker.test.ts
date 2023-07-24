import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'

import {
  ICollateral,
  IController,
  IERC20,
  MultiInvoker,
  MultiInvoker__factory,
  IProduct,
  IIncentivizer,
  IEmptySetReserve,
  IBatcher,
  TestnetVault,
} from '../../../types/generated'
import { IMultiInvoker } from '../../../types/generated/contracts/interfaces/IMultiInvoker.sol/IMultiInvoker'
import { InvokerAction, buildInvokerActions } from '../../util'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const { ethers } = HRE
use(smock.matchers)

describe('MultiInvoker', () => {
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
  let vault: FakeContract<TestnetVault>
  let multiInvoker: MultiInvoker

  const multiInvokerFixture = async () => {
    ;[owner, user] = await ethers.getSigners()
  }

  beforeEach(async () => {
    await loadFixture(multiInvokerFixture)

    usdc = await smock.fake<IERC20>('IERC20')
    dsu = await smock.fake<IERC20>('IERC20')
    collateral = await smock.fake<ICollateral>('ICollateral')
    batcher = await smock.fake<IBatcher>('Batcher')
    controller = await smock.fake<IController>('IController')
    incentivizer = await smock.fake<IIncentivizer>('IIncentivizer')
    product = await smock.fake<IProduct>('IProduct')
    reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
    vault = await smock.fake<TestnetVault>('TestnetVault')

    controller.collateral.returns(collateral.address)
    controller.incentivizer.returns(incentivizer.address)
    collateral.token.returns(dsu.address)
    batcher.DSU.returns(dsu.address)

    multiInvoker = await new MultiInvoker__factory(owner).deploy(
      usdc.address,
      batcher.address,
      reserve.address,
      controller.address,
    )

    dsu.allowance.whenCalledWith(multiInvoker.address, collateral.address).returns(0)
    dsu.approve.whenCalledWith(collateral.address, 0).returns(true)
    dsu.approve.whenCalledWith(collateral.address, ethers.constants.MaxUint256).returns(true)

    dsu.allowance.whenCalledWith(multiInvoker.address, batcher.address).returns(0)
    dsu.approve.whenCalledWith(batcher.address, 0).returns(true)
    dsu.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)

    dsu.allowance.whenCalledWith(multiInvoker.address, reserve.address).returns(0)
    dsu.approve.whenCalledWith(reserve.address, 0).returns(true)
    dsu.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)
    dsu.balanceOf.whenCalledWith(batcher.address).returns(constants.MaxUint256)

    usdc.allowance.whenCalledWith(multiInvoker.address, batcher.address).returns(0)
    usdc.approve.whenCalledWith(batcher.address, 0).returns(true)
    usdc.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)

    usdc.allowance.whenCalledWith(multiInvoker.address, reserve.address).returns(0)
    usdc.approve.whenCalledWith(reserve.address, 0).returns(true)
    usdc.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)
    usdc.balanceOf.whenCalledWith(batcher.address).returns(1_000_000e6)

    await multiInvoker.initialize()
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect((await multiInvoker.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
      expect((await multiInvoker.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
      expect((await multiInvoker.batcher()).toLowerCase()).to.equal(batcher.address.toLowerCase())
      expect((await multiInvoker.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
      expect((await multiInvoker.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
      expect((await multiInvoker.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
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
    let actions: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
    const amount = utils.parseEther('100')
    const usdcAmount = 100e6
    const feeAmount = utils.parseEther('10')
    const position = utils.parseEther('12')
    const programs = [1, 2, 3]
    const vaultAmount = utils.parseEther('567')
    const vaultUSDCAmount = 567e6

    const fixture = async () => {
      actions = buildInvokerActions({
        userAddress: user.address,
        productAddress: product.address,
        position,
        amount,
        programs,
        vaultAddress: vault.address,
        vaultAmount,
        feeAmount: feeAmount,
      })
      dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, amount).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, usdcAmount).returns(true)
      usdc.transfer.whenCalledWith(user.address, usdcAmount).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, vaultUSDCAmount).returns(true)

      // Vault deposits
      dsu.allowance.whenCalledWith(multiInvoker.address, vault.address).returns(0)
      dsu.approve.whenCalledWith(vault.address, vaultAmount).returns(true)
      dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, vaultAmount).returns(true)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('does nothing on NOOP action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.NOOP])).to.not.be.reverted
    })

    it('deposits on DEPOSIT action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.DEPOSIT])).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, amount)
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
    })

    it('withdraws on WITHDRAW action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.WITHDRAW])).to.not.be.reverted

      expect(collateral.withdrawFrom).to.have.been.calledWith(user.address, user.address, product.address, amount)
    })

    it('opens a take position on OPEN_TAKE action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.OPEN_TAKE])).to.not.be.reverted

      expect(product.openTakeFor).to.have.been.calledWith(user.address, position)
    })

    it('closes a take position on CLOSE_TAKE action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.CLOSE_TAKE])).to.not.be.reverted

      expect(product.closeTakeFor).to.have.been.calledWith(user.address, position)
    })

    it('opens a make position on OPEN_MAKE action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.OPEN_MAKE])).to.not.be.reverted

      expect(product.openMakeFor).to.have.been.calledWith(user.address, position)
    })

    it('closes a make position on CLOSE_MAKE action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.CLOSE_MAKE])).to.not.be.reverted

      expect(product.closeMakeFor).to.have.been.calledWith(user.address, position)
    })

    it('claims incentive rewards on CLAIM action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.CLAIM])).to.not.be.reverted

      expect(incentivizer.claimFor).to.have.been.calledWith(user.address, product.address, programs)
    })

    it('wraps USDC to DSU on WRAP action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.WRAP])).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)
      expect(batcher.wrap).to.have.been.calledWith(amount, user.address)
    })

    it('wraps USDC to DSU using RESERVE on WRAP action if amount is greater than batcher balance', async () => {
      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)
      dsu.transfer.whenCalledWith(user.address, amount).returns(true)

      await expect(multiInvoker.connect(user).invoke([actions.WRAP])).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)
      expect(reserve.mint).to.have.been.calledWith(amount)
      expect(dsu.transfer).to.have.been.calledWith(user.address, amount)
    })

    it('unwraps DSU to USDC on UNWRAP action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.UNWRAP])).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, amount)
      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)
    })

    it('unwraps DSU to USDC using RESERVE on UNWRAP action if amount is greater than batcher balance', async () => {
      usdc.balanceOf.whenCalledWith(batcher.address).returns(0)
      usdc.transfer.whenCalledWith(user.address, amount).returns(true)

      await expect(multiInvoker.connect(user).invoke([actions.UNWRAP])).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, amount)
      expect(reserve.redeem).to.have.been.calledWith(amount)
      expect(usdc.transfer).to.have.been.calledWith(user.address, usdcAmount)
    })

    it('wraps USDC to DSU then deposits DSU on WRAP_AND_DEPOSIT action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.WRAP_AND_DEPOSIT])).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)
      expect(batcher.wrap).to.have.been.calledWith(amount, multiInvoker.address)
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
    })

    it('wraps USDC to DSU using RESERVE then deposits DSU on WRAP_AND_DEPOSIT action if amount is greater than batcher balance', async () => {
      dsu.balanceOf.whenCalledWith(batcher.address).returns(0)
      dsu.transfer.whenCalledWith(multiInvoker.address, amount).returns(true)

      await expect(multiInvoker.connect(user).invoke([actions.WRAP_AND_DEPOSIT])).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)
      expect(reserve.mint).to.have.been.calledWith(amount)
      expect(collateral.depositTo).to.have.been.calledWith(user.address, product.address, amount)
    })

    it('withdraws then unwraps DSU to USDC on WITHDRAW_AND_UNWRAP action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.WITHDRAW_AND_UNWRAP])).to.not.be.reverted

      expect(collateral.withdrawFrom).to.have.been.calledWith(
        user.address,
        multiInvoker.address,
        product.address,
        amount,
      )

      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)
    })

    it('handles max uint256 amounts in WITHDRAW_AND_UNWRAP action', async () => {
      const maxActions = buildInvokerActions({
        userAddress: user.address,
        productAddress: product.address,
        position,
        amount: ethers.constants.MaxUint256,
        programs,
        vaultAddress: vault.address,
        vaultAmount,
        feeAmount: feeAmount,
      })
      collateral['collateral(address,address)'].whenCalledWith(user.address, product.address).returns(amount)

      await expect(multiInvoker.connect(user).invoke([maxActions.WITHDRAW_AND_UNWRAP])).to.not.be.reverted

      expect(collateral.withdrawFrom).to.have.been.calledWith(
        user.address,
        multiInvoker.address,
        product.address,
        amount,
      )

      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)
    })

    it('withdraws then unwraps DSU to USDC using RESERVE on WITHDRAW_AND_UNWRAP action if amount is greater than batcher balance', async () => {
      usdc.balanceOf.whenCalledWith(batcher.address).returns(0)

      await expect(multiInvoker.connect(user).invoke([actions.WITHDRAW_AND_UNWRAP])).to.not.be.reverted

      expect(collateral.withdrawFrom).to.have.been.calledWith(
        user.address,
        multiInvoker.address,
        product.address,
        amount,
      )

      expect(reserve.redeem).to.have.been.calledWith(amount)
      expect(usdc.transfer).to.have.been.calledWith(user.address, usdcAmount)
    })

    it('deposits to vault on VAULT_DEPOSIT action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.VAULT_DEPOSIT])).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, vaultAmount)
      expect(dsu.approve).to.have.been.calledWith(vault.address, vaultAmount)
      expect(vault.deposit).to.have.been.calledWith(vaultAmount, user.address)
    })

    it('redeems from vault on VAULT_REDEEM action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.VAULT_REDEEM])).to.not.be.reverted

      expect(vault.redeem).to.have.been.calledWith(vaultAmount, user.address)
    })

    it('claims from vault on VAULT_CLAIM action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.VAULT_CLAIM])).to.not.be.reverted

      expect(vault.claim).to.have.been.calledWith(user.address)
    })

    it('wraps USDC to DSU then deposits DSU to the vault on VAULT_WRAP_AND_DEPOSIT action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.VAULT_WRAP_AND_DEPOSIT])).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, vaultUSDCAmount)
      expect(batcher.wrap).to.have.been.calledWith(vaultAmount, multiInvoker.address)
      expect(dsu.approve).to.have.been.calledWith(vault.address, vaultAmount)
      expect(vault.deposit).to.have.been.calledWith(vaultAmount, user.address)
    })

    it('performs a multi invoke', async () => {
      // do not attemp to chage fee in unit tests
      const actionsLessChargeFee = Object.values(actions).slice(0, -1)

      await expect(multiInvoker.connect(user).invoke(actionsLessChargeFee)).to.not.be.reverted

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
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, amount)
      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)

      // Vault deposit
      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, vaultAmount)
      expect(dsu.approve).to.have.been.calledWith(vault.address, vaultAmount)
      expect(vault.deposit).to.have.been.calledWith(vaultAmount, user.address)

      // Vault redeem
      expect(vault.redeem).to.have.been.calledWith(vaultAmount, user.address)

      // Vault claim
      expect(vault.claim).to.have.been.calledWith(user.address)

      // Vault wrap and deposit
      expect(batcher.wrap).to.have.been.calledWith(vaultAmount, multiInvoker.address)
    })
  })

  context('batcher address is 0', () => {
    beforeEach(async () => {
      multiInvoker = await new MultiInvoker__factory(owner).deploy(
        usdc.address,
        constants.AddressZero,
        reserve.address,
        controller.address,
      )

      dsu.allowance.whenCalledWith(multiInvoker.address, collateral.address).returns(0)
      dsu.approve.whenCalledWith(collateral.address, ethers.constants.MaxUint256).returns(true)
      dsu.allowance.whenCalledWith(multiInvoker.address, reserve.address).returns(0)
      dsu.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)

      usdc.allowance.whenCalledWith(multiInvoker.address, reserve.address).returns(0)
      usdc.approve.whenCalledWith(reserve.address, ethers.constants.MaxUint256).returns(true)

      await multiInvoker.initialize()
    })

    describe('#constructor', () => {
      it('constructs correctly', async () => {
        expect((await multiInvoker.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
        expect((await multiInvoker.DSU()).toLowerCase()).to.equal(dsu.address.toLowerCase())
        expect((await multiInvoker.batcher()).toLowerCase()).to.equal(constants.AddressZero)
        expect((await multiInvoker.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
        expect((await multiInvoker.collateral()).toLowerCase()).to.equal(collateral.address.toLowerCase())
        expect((await multiInvoker.reserve()).toLowerCase()).to.equal(reserve.address.toLowerCase())
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
      let actions: { [action in InvokerAction]: IMultiInvoker.InvocationStruct }
      const amount = utils.parseEther('100')
      const usdcAmount = 100e6
      const feeAmount = utils.parseEther('10')
      const position = utils.parseEther('12')
      const programs = [1, 2, 3]

      const fixture = async () => {
        actions = buildInvokerActions({
          userAddress: user.address,
          productAddress: product.address,
          position,
          amount,
          programs,
          feeAmount: feeAmount,
        })
        dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, amount).returns(true)
        usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, usdcAmount).returns(true)
        usdc.transfer.whenCalledWith(user.address, usdcAmount).returns(true)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('wraps USDC to DSU using RESERVE on WRAP action', async () => {
        dsu.transfer.whenCalledWith(user.address, amount).returns(true)

        await expect(multiInvoker.connect(user).invoke([actions.WRAP])).to.not.be.reverted

        expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)
        expect(reserve.mint).to.have.been.calledWith(amount)
        expect(dsu.transfer).to.have.been.calledWith(user.address, amount)
      })

      it('unwraps DSU to USDC using RESERVE on UNWRAP action', async () => {
        usdc.transfer.whenCalledWith(user.address, amount).returns(true)

        await expect(multiInvoker.connect(user).invoke([actions.UNWRAP])).to.not.be.reverted

        expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, amount)
        expect(reserve.redeem).to.have.been.calledWith(amount)
        expect(usdc.transfer).to.have.been.calledWith(user.address, usdcAmount)
      })
    })
  })
})

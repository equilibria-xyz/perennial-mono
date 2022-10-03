import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'
import { utils } from 'ethers'

import {
  ICollateral,
  IController,
  IERC20,
  IBatcher,
  MultiInvoker,
  MultiInvoker__factory,
  IProduct,
  IIncentivizer,
} from '../../../types/generated'
import { IMultiInvoker } from '../../../types/generated/contracts/interfaces/IMultiInvoker'

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
  let multiInvoker: MultiInvoker

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    usdc = await smock.fake<IERC20>('IERC20')
    dsu = await smock.fake<IERC20>('IERC20')
    collateral = await smock.fake<ICollateral>('ICollateral')
    batcher = await smock.fake<IBatcher>('IBatcher')
    controller = await smock.fake<IController>('IController')
    incentivizer = await smock.fake<IIncentivizer>('IIncentivizer')
    product = await smock.fake<IProduct>('IProduct')

    controller.collateral.returns(collateral.address)
    controller.incentivizer.returns(incentivizer.address)
    collateral.token.returns(dsu.address)

    multiInvoker = await new MultiInvoker__factory(owner).deploy(usdc.address, controller.address, batcher.address)

    dsu.allowance.whenCalledWith(multiInvoker.address, collateral.address).returns(0)
    dsu.approve.whenCalledWith(collateral.address, ethers.constants.MaxUint256).returns(true)
    dsu.allowance.whenCalledWith(multiInvoker.address, batcher.address).returns(0)
    dsu.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)
    usdc.allowance.whenCalledWith(multiInvoker.address, batcher.address).returns(0)
    usdc.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)

    await multiInvoker.initialize()
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect((await multiInvoker.USDC()).toLowerCase()).to.equal(usdc.address.toLowerCase())
      expect((await multiInvoker.controller()).toLowerCase()).to.equal(controller.address.toLowerCase())
      expect((await multiInvoker.batcher()).toLowerCase()).to.equal(batcher.address.toLowerCase())
    })
  })

  describe('#initialize', () => {
    it('initializes correctly', async () => {
      expect(dsu.approve).to.be.calledWith(collateral.address, ethers.constants.MaxUint256)
      expect(dsu.approve).to.be.calledWith(batcher.address, ethers.constants.MaxUint256)
      expect(usdc.approve).to.be.calledWith(batcher.address, ethers.constants.MaxUint256)
    })
  })

  describe('#invoke', () => {
    let actions: { [key: string]: IMultiInvoker.InvocationStruct }
    const amount = utils.parseEther('100')
    const usdcAmount = 100e6
    const position = utils.parseEther('12')
    const programs = [1, 2, 3]

    beforeEach(() => {
      actions = {
        DEPOSIT: {
          action: 1,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['address', 'uint'], [user.address, amount]),
        },
        WITHDRAW: {
          action: 2,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['address', 'uint'], [user.address, amount]),
        },
        OPEN_TAKE: {
          action: 3,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['uint'], [position]),
        },
        CLOSE_TAKE: {
          action: 4,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['uint'], [position]),
        },
        OPEN_MAKE: {
          action: 5,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['uint'], [position]),
        },
        CLOSE_MAKE: {
          action: 6,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['uint'], [position]),
        },
        CLAIM: {
          action: 7,
          product: product.address,
          args: utils.defaultAbiCoder.encode(['uint[]'], [programs]),
        },
        WRAP: {
          action: 8,
          product: ethers.constants.AddressZero,
          args: utils.defaultAbiCoder.encode(['address', 'uint'], [user.address, amount]),
        },
        UNWRAP: {
          action: 9,
          product: ethers.constants.AddressZero,
          args: utils.defaultAbiCoder.encode(['address', 'uint'], [user.address, amount]),
        },
      }
      dsu.transferFrom.whenCalledWith(user.address, multiInvoker.address, amount).returns(true)
      usdc.transferFrom.whenCalledWith(user.address, multiInvoker.address, usdcAmount).returns(true)
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
      await multiInvoker.connect(user).invoke([actions.CLAIM])

      expect(incentivizer.claimFor).to.have.been.calledWith(user.address, product.address, programs)
    })

    it('wraps DSU to USDC on WRAP action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.WRAP])).to.not.be.reverted

      expect(dsu.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, amount)
      expect(batcher.wrap).to.have.been.calledWith(amount, user.address)
    })

    it('unwraps USDC to DSU on UNWRAP action', async () => {
      await expect(multiInvoker.connect(user).invoke([actions.UNWRAP])).to.not.be.reverted

      expect(usdc.transferFrom).to.have.been.calledWith(user.address, multiInvoker.address, usdcAmount)
      expect(batcher.unwrap).to.have.been.calledWith(amount, user.address)
    })

    it('performs a multi invoke', async () => {
      await expect(multiInvoker.connect(user).invoke(Object.values(actions))).to.not.be.reverted

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
    })
  })
})

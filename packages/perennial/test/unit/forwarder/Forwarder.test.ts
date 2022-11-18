import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { nextContractAddress } from '../../../../common/testutil/contract'
import { expect, use } from 'chai'
import { utils } from 'ethers'
import HRE from 'hardhat'

import {
  IBatcher,
  ICollateral,
  IProduct,
  Forwarder,
  Forwarder__factory,
  IERC20Metadata,
} from '../../../types/generated'

const { ethers } = HRE
use(smock.matchers)

describe('Forwarder', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let account: SignerWithAddress
  let collateral: FakeContract<ICollateral>
  let product: FakeContract<IProduct>
  let batcher: FakeContract<IBatcher>
  let usdc: FakeContract<IERC20Metadata>
  let dsu: FakeContract<IERC20Metadata>
  let forwarder: Forwarder

  beforeEach(async () => {
    ;[owner, user, account] = await ethers.getSigners()

    collateral = await smock.fake<ICollateral>('ICollateral')
    product = await smock.fake<IProduct>('IProduct')
    batcher = await smock.fake<IBatcher>('IBatcher')
    usdc = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')

    const forwarderAddress = nextContractAddress(owner, 4)
    usdc.allowance.whenCalledWith(forwarderAddress, batcher.address).returns(0)
    usdc.approve.whenCalledWith(batcher.address, ethers.constants.MaxUint256).returns(true)
    dsu.allowance.whenCalledWith(forwarderAddress, batcher.address).returns(0)
    dsu.approve.whenCalledWith(collateral.address, ethers.constants.MaxUint256).returns(true)

    forwarder = await new Forwarder__factory(owner).deploy(
      usdc.address,
      dsu.address,
      batcher.address,
      collateral.address,
    )
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect(await forwarder.USDC()).to.equal(usdc.address)
      expect(await forwarder.DSU()).to.equal(dsu.address)
      expect(await forwarder.batcher()).to.equal(batcher.address)
      expect(await forwarder.collateral()).to.equal(collateral.address)
    })

    it('reverts on invalid addresses', async () => {
      await expect(
        new Forwarder__factory(owner).deploy(user.address, dsu.address, batcher.address, collateral.address),
      ).to.be.revertedWithCustomError(forwarder, 'ForwarderNotContractAddressError')
      await expect(
        new Forwarder__factory(owner).deploy(usdc.address, user.address, batcher.address, collateral.address),
      ).to.be.revertedWithCustomError(forwarder, 'ForwarderNotContractAddressError')
      await expect(
        new Forwarder__factory(owner).deploy(user.address, dsu.address, user.address, collateral.address),
      ).to.be.revertedWithCustomError(forwarder, 'ForwarderNotContractAddressError')
      await expect(
        new Forwarder__factory(owner).deploy(user.address, dsu.address, batcher.address, user.address),
      ).to.be.revertedWithCustomError(forwarder, 'ForwarderNotContractAddressError')
    })
  })

  describe('#wrapAndDeposit', () => {
    it('pulls USDC from the sender, wraps it as DSU and deposits it as collateral to the product account', async () => {
      usdc.transferFrom.whenCalledWith(user.address, forwarder.address, 10e6).returns(true)
      batcher.wrap.whenCalledWith(utils.parseEther('10'), forwarder.address).returns()
      collateral.depositTo.whenCalledWith(account.address, product, utils.parseEther('10')).returns()

      await expect(
        forwarder.connect(user).wrapAndDeposit(
          account.address,
          product.address,
          utils.parseEther('10'),
          { gasLimit: 30e6 }, // https://github.com/defi-wonderland/smock/issues/99
        ),
      )
        .to.emit(forwarder, 'WrapAndDeposit')
        .withArgs(account.address, product.address, utils.parseEther('10'))

      expect(usdc.transferFrom).to.have.been.calledOnceWith(user.address, forwarder.address, 10e6)
      expect(batcher.wrap).to.have.been.calledOnceWith(utils.parseEther('10'), forwarder.address)
      expect(collateral.depositTo).to.have.been.calledOnceWith(account.address, product.address, utils.parseEther('10'))
    })

    it('rounds correctly', async () => {
      usdc.transferFrom.whenCalledWith(user.address, forwarder.address, 1e6).returns(true)
      batcher.wrap.whenCalledWith(utils.parseEther('0.999999999999'), forwarder.address).returns()
      collateral.depositTo.whenCalledWith(account.address, product, utils.parseEther('10')).returns()

      await expect(
        forwarder.connect(user).wrapAndDeposit(
          account.address,
          product.address,
          utils.parseEther('0.999999999999'),
          { gasLimit: 30e6 }, // https://github.com/defi-wonderland/smock/issues/99
        ),
      )
        .to.emit(forwarder, 'WrapAndDeposit')
        .withArgs(account.address, product.address, utils.parseEther('0.999999999999'))

      expect(usdc.transferFrom).to.have.been.calledOnceWith(user.address, forwarder.address, 1e6)
      expect(batcher.wrap).to.have.been.calledOnceWith(utils.parseEther('0.999999999999'), forwarder.address)
      expect(collateral.depositTo).to.have.been.calledOnceWith(
        account.address,
        product.address,
        utils.parseEther('0.999999999999'),
      )
    })
  })
})

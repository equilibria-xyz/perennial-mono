import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  IProduct,
  CoordinatorDelegatable,
  CoordinatorDelegatable__factory,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../../../types/generated'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { constants, utils } from 'ethers'

const { ethers } = HRE
use(smock.matchers)

describe('CoordinatorDelegatable', () => {
  let owner: SignerWithAddress
  let delegate: SignerWithAddress
  let noaccess: SignerWithAddress
  let proxyAdmin: SignerWithAddress
  let product: FakeContract<IProduct>
  let impl: CoordinatorDelegatable
  let proxy: TransparentUpgradeableProxy
  let coordinatorDel: CoordinatorDelegatable

  const fixture = async () => {
    ;[owner, delegate, noaccess, proxyAdmin] = await ethers.getSigners()
  }

  beforeEach(async () => {
    await loadFixture(fixture)

    product = await smock.fake<IProduct>('IProduct')
    impl = await new CoordinatorDelegatable__factory(owner).deploy()
    proxy = await new TransparentUpgradeableProxy__factory(proxyAdmin).deploy(impl.address, proxyAdmin.address, '0x')
    coordinatorDel = CoordinatorDelegatable__factory.connect(proxy.address, owner)
  })

  describe('deployment', () => {
    it('deploys the impl behind a proxy', async () => {
      expect(await proxy.callStatic.admin()).to.equal(proxyAdmin.address)
      expect(await proxy.callStatic.implementation()).to.equal(impl.address)
    })
  })

  describe('#initialize', () => {
    it('initializes correctly', async () => {
      await coordinatorDel.initialize()

      expect(await coordinatorDel.owner()).to.equal(owner.address)
      expect(await coordinatorDel.paramAdmin()).to.equal(constants.AddressZero)
    })

    it('reverts if already initialized', async () => {
      await coordinatorDel.initialize()
      await expect(coordinatorDel.initialize())
        .to.be.revertedWithCustomError(coordinatorDel, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('owner', () => {
    beforeEach(async () => {
      await coordinatorDel.initialize()
    })

    it('can call execute', async () => {
      const fn = product.interface.encodeFunctionData('updateOracle', [product.address])
      product.updateOracle.whenCalledWith(product.address).returns()

      await expect(coordinatorDel.execute(product.address, fn, 0)).to.not.be.reverted

      expect(product.updateOracle).to.have.been.calledWith(product.address)

      await expect(coordinatorDel.execute(product.address, '0x', 0)).to.not.be.reverted
    })

    it('can grant and revoke param admin role', async () => {
      await expect(coordinatorDel.updateParamAdmin(delegate.address)).to.not.be.reverted
      expect(await coordinatorDel.paramAdmin()).to.equal(delegate.address)

      await expect(coordinatorDel.updateParamAdmin(constants.AddressZero)).to.not.be.reverted
      expect(await coordinatorDel.paramAdmin()).to.equal(constants.AddressZero)
    })

    itPerformsProductUpdates(() => [coordinatorDel, owner, product])
  })

  describe('paramAdmin', () => {
    beforeEach(async () => {
      await coordinatorDel.initialize()
      await coordinatorDel.updateParamAdmin(delegate.address)
    })

    itPerformsProductUpdates(() => [coordinatorDel, delegate, product])

    it('cannot execute arbitrary functions', async () => {
      const fn = product.interface.encodeFunctionData('updateOracle', [product.address])
      await expect(coordinatorDel.connect(delegate).execute(product.address, fn, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'UOwnableNotOwnerError')
        .withArgs(delegate.address)
    })

    it('cannot update the param admin', async () => {
      await expect(coordinatorDel.connect(delegate).updateParamAdmin(delegate.address))
        .to.be.revertedWithCustomError(coordinatorDel, 'UOwnableNotOwnerError')
        .withArgs(delegate.address)
    })
  })

  describe('noaccess', () => {
    it('cannot execute arbitrary functions', async () => {
      const fn = product.interface.encodeFunctionData('updateOracle', [product.address])
      await expect(coordinatorDel.connect(noaccess).execute(product.address, fn, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'UOwnableNotOwnerError')
        .withArgs(noaccess.address)
    })

    it('cannot call any param admin functions', async () => {
      await expect(coordinatorDel.connect(noaccess).updateMaintenance(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateMakerFee(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateTakerFee(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateMakerLimit(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(
        coordinatorDel.connect(noaccess).updateUtilizationCurve(product.address, {
          minRate: 0,
          maxRate: 0,
          targetRate: 0,
          targetUtilization: 0,
        }),
      )
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
    })
  })

  describe('upgradability', () => {
    beforeEach(async () => {
      await coordinatorDel.initialize()
    })

    it('can upgrade to a new impl', async () => {
      const newImpl = await new CoordinatorDelegatable__factory(owner).deploy()
      await expect(proxy.upgradeTo(newImpl.address)).to.not.be.reverted
      expect(await proxy.callStatic.implementation()).to.equal(newImpl.address)
    })

    context('after upgrade', () => {
      beforeEach(async () => {
        await coordinatorDel.updateParamAdmin(delegate.address)
        const newImpl = await new CoordinatorDelegatable__factory(owner).deploy()
        await proxy.upgradeTo(newImpl.address)
      })

      it('maintains correct state', async () => {
        await expect(coordinatorDel.initialize())
          .to.be.revertedWithCustomError(coordinatorDel, 'UInitializableAlreadyInitializedError')
          .withArgs(1)
        expect(await coordinatorDel.owner()).to.equal(owner.address)
        expect(await coordinatorDel.paramAdmin()).to.equal(delegate.address)
      })
    })
  })
})

function itPerformsProductUpdates(
  getParams: () => [CoordinatorDelegatable, SignerWithAddress, FakeContract<IProduct>],
) {
  let coordinatorDel: CoordinatorDelegatable
  let signer: SignerWithAddress
  let product: FakeContract<IProduct>

  beforeEach(() => {
    ;[coordinatorDel, signer, product] = getParams()
  })

  it('can call updateMaintenance', async () => {
    const newMaintenance = utils.parseEther('0.025')
    product.updateMaintenance.whenCalledWith(newMaintenance).returns()

    await expect(coordinatorDel.connect(signer).updateMaintenance(product.address, newMaintenance)).to.not.be.reverted

    expect(product.updateMaintenance).to.have.been.calledWith(newMaintenance)
  })

  it('reverts if maintenance is less than MIN_MAINTENANCE', async () => {
    const minMaintenance = await coordinatorDel.MIN_MAINTENANCE()
    expect(minMaintenance).to.equal(utils.parseEther('0.01'))

    await expect(
      coordinatorDel.connect(signer).updateMaintenance(product.address, minMaintenance.sub(1)),
    ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidParamValueError')
  })

  it('can call updateMakerFee', async () => {
    const newMakerFee = utils.parseEther('0.00567')
    product.updateMakerFee.whenCalledWith(newMakerFee).returns()

    await expect(coordinatorDel.connect(signer).updateMakerFee(product.address, newMakerFee)).to.not.be.reverted

    expect(product.updateMakerFee).to.have.been.calledWith(newMakerFee)
  })

  it('reverts if makerFee is greater than MAX_FEE', async () => {
    const maxFee = await coordinatorDel.MAX_FEE()
    expect(maxFee).to.equal(utils.parseEther('0.01'))

    await expect(
      coordinatorDel.connect(signer).updateMakerFee(product.address, maxFee.add(1)),
    ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidParamValueError')
  })

  it('can call updateTakerFee', async () => {
    const newTakerFee = utils.parseEther('0.0012')
    product.updateTakerFee.whenCalledWith(newTakerFee).returns()

    await expect(coordinatorDel.connect(signer).updateTakerFee(product.address, newTakerFee)).to.not.be.reverted

    expect(product.updateTakerFee).to.have.been.calledWith(newTakerFee)
  })

  it('reverts if takerFee is greater than MAX_FEE', async () => {
    const maxFee = await coordinatorDel.MAX_FEE()
    expect(maxFee).to.equal(utils.parseEther('0.01'))

    await expect(
      coordinatorDel.connect(signer).updateTakerFee(product.address, maxFee.add(1)),
    ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidParamValueError')
  })

  it('can call updateMakerLimit', async () => {
    const newMakerLimit = utils.parseEther('12345')
    product.updateMakerLimit.whenCalledWith(newMakerLimit).returns()

    await expect(coordinatorDel.connect(signer).updateMakerLimit(product.address, newMakerLimit)).to.not.be.reverted

    expect(product.updateMakerLimit).to.have.been.calledWith(newMakerLimit)
  })

  it('can call updateUtilizationBuffer', async () => {
    const newBuffer = utils.parseEther('0.1')
    product.updateUtilizationBuffer.whenCalledWith(newBuffer).returns()

    await expect(coordinatorDel.connect(signer).updateUtilizationBuffer(product.address, newBuffer)).to.not.be.reverted

    expect(product.updateUtilizationBuffer).to.have.been.calledWith(newBuffer)
  })

  it('can call updateUtilizationCurve', async () => {
    const newCurve = {
      minRate: utils.parseEther('0.01'),
      maxRate: utils.parseEther('1'),
      targetRate: utils.parseEther('0.5'),
      targetUtilization: utils.parseEther('0.8'),
    }
    product.updateUtilizationCurve.whenCalledWith(newCurve).returns()

    await expect(coordinatorDel.connect(signer).updateUtilizationCurve(product.address, newCurve)).to.not.be.reverted

    expect(product.updateUtilizationCurve).to.have.been.calledWith(newCurve)
  })

  it('reverts if any part of the curve rate is greater than MAX_CURVE_RATE', async () => {
    const maxRate = await coordinatorDel.MAX_CURVE_RATE()
    expect(maxRate).to.equal(utils.parseEther('10')) // 100%

    await expect(
      coordinatorDel.connect(signer).updateUtilizationCurve(product.address, {
        minRate: maxRate.add(1),
        maxRate: maxRate,
        targetRate: maxRate,
        targetUtilization: utils.parseEther('0.8'),
      }),
    ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidParamValueError')

    await expect(
      coordinatorDel.connect(signer).updateUtilizationCurve(product.address, {
        minRate: maxRate,
        maxRate: maxRate.add(1),
        targetRate: maxRate,
        targetUtilization: utils.parseEther('0.8'),
      }),
    ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidParamValueError')

    await expect(
      coordinatorDel.connect(signer).updateUtilizationCurve(product.address, {
        minRate: maxRate,
        maxRate: maxRate,
        targetRate: maxRate.add(1),
        targetUtilization: utils.parseEther('0.8'),
      }),
    ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidParamValueError')
  })
}

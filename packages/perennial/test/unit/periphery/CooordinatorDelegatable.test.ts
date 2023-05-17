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

const initArgs = [
  constants.AddressZero,
  { min: 0, max: constants.MaxUint256 },
  { min: 0, max: constants.MaxUint256 },
  { min: 0, max: constants.MaxUint256 },
  { min: 0, max: constants.MaxUint256 },
  { min: 0, max: constants.MaxUint256 },
  {
    minMinRate: 0,
    maxMinRate: constants.MaxInt256,
    minMaxRate: 0,
    maxMaxRate: constants.MaxInt256,
    minTargetRate: 0,
    maxTargetRate: constants.MaxInt256,
    minTargetUtilization: 0,
    maxTargetUtilization: constants.MaxUint256,
  },
] as const

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
    impl = await new CoordinatorDelegatable__factory(owner).deploy(product.address)
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
      await coordinatorDel.initialize(...initArgs)

      expect(await coordinatorDel.owner()).to.equal(owner.address)
      expect(await coordinatorDel.paramAdmin()).to.equal(constants.AddressZero)
    })

    it('reverts if already initialized', async () => {
      await coordinatorDel.initialize(...initArgs)
      await expect(coordinatorDel.initialize(...initArgs))
        .to.be.revertedWithCustomError(coordinatorDel, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('owner', () => {
    beforeEach(async () => {
      await coordinatorDel.initialize(...initArgs)
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
      await coordinatorDel.initialize(...initArgs)
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
      await expect(coordinatorDel.connect(noaccess).updateMaintenance(0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateMakerFee(0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateTakerFee(0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateMakerLimit(0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(
        coordinatorDel.connect(noaccess).updateUtilizationCurve({
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
      await coordinatorDel.initialize(...initArgs)
    })

    it('can upgrade to a new impl', async () => {
      const newImpl = await new CoordinatorDelegatable__factory(owner).deploy(product.address)
      await expect(proxy.upgradeTo(newImpl.address)).to.not.be.reverted
      expect(await proxy.callStatic.implementation()).to.equal(newImpl.address)
    })

    context('after upgrade', () => {
      beforeEach(async () => {
        await coordinatorDel.updateParamAdmin(delegate.address)
        const newImpl = await new CoordinatorDelegatable__factory(owner).deploy(product.address)
        await proxy.upgradeTo(newImpl.address)
      })

      it('maintains correct state', async () => {
        await expect(coordinatorDel.initialize(...initArgs))
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

  describe('#updateMaintenance', async () => {
    it('updates the value', async () => {
      const newMaintenance = utils.parseEther('0.025')
      product.updateMaintenance.whenCalledWith(newMaintenance).returns()

      await expect(coordinatorDel.connect(signer).updateMaintenance(newMaintenance)).to.not.be.reverted

      expect(product.updateMaintenance).to.have.been.calledWith(newMaintenance)
    })

    it('reverts if values exceed limits', async () => {
      await coordinatorDel.updateMaintenanceLimits({ min: utils.parseEther('0.5'), max: utils.parseEther('0.6') })
      await expect(coordinatorDel.connect(signer).updateMaintenance(utils.parseEther('0.4')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.4'))
      await expect(coordinatorDel.connect(signer).updateMaintenance(utils.parseEther('0.7')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.7'))
    })
  })

  describe('#updateMakerFee', async () => {
    it('updates the value', async () => {
      const newMakerFee = utils.parseEther('0.00567')
      product.updateMakerFee.whenCalledWith(newMakerFee).returns()

      await expect(coordinatorDel.connect(signer).updateMakerFee(newMakerFee)).to.not.be.reverted

      expect(product.updateMakerFee).to.have.been.calledWith(newMakerFee)
    })

    it('reverts if values exceed limits', async () => {
      await coordinatorDel.updateMakerFeeLimits({ min: utils.parseEther('0.5'), max: utils.parseEther('0.6') })
      await expect(coordinatorDel.connect(signer).updateMakerFee(utils.parseEther('0.4')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.4'))
      await expect(coordinatorDel.connect(signer).updateMakerFee(utils.parseEther('0.7')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.7'))
    })
  })

  describe('#updateTakerFee', async () => {
    it('updates the value', async () => {
      const newTakerFee = utils.parseEther('0.012')
      product.updateTakerFee.whenCalledWith(newTakerFee).returns()

      await expect(coordinatorDel.connect(signer).updateTakerFee(newTakerFee)).to.not.be.reverted

      expect(product.updateTakerFee).to.have.been.calledWith(newTakerFee)
    })

    it('reverts if values exceed limits', async () => {
      await coordinatorDel.updateTakerFeeLimits({ min: utils.parseEther('0.5'), max: utils.parseEther('0.6') })
      await expect(coordinatorDel.connect(signer).updateTakerFee(utils.parseEther('0.4')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.4'))
      await expect(coordinatorDel.connect(signer).updateTakerFee(utils.parseEther('0.7')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.7'))
    })
  })

  describe('#updateMakerLimit', async () => {
    it('updates the value', async () => {
      const newMakerLimit = utils.parseEther('12345')
      product.updateMakerLimit.whenCalledWith(newMakerLimit).returns()

      await expect(coordinatorDel.connect(signer).updateMakerLimit(newMakerLimit)).to.not.be.reverted

      expect(product.updateMakerLimit).to.have.been.calledWith(newMakerLimit)
    })

    it('reverts if values exceed limits', async () => {
      await coordinatorDel.updateMakerLimitLimits({ min: utils.parseEther('0.5'), max: utils.parseEther('0.6') })
      await expect(coordinatorDel.connect(signer).updateMakerLimit(utils.parseEther('0.4')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.4'))
      await expect(coordinatorDel.connect(signer).updateMakerLimit(utils.parseEther('0.7')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.7'))
    })
  })

  describe('#updateUtilizationBuffer', async () => {
    it('updates the value', async () => {
      const newBuffer = utils.parseEther('0.1')
      product.updateUtilizationBuffer.whenCalledWith(newBuffer).returns()

      await expect(coordinatorDel.connect(signer).updateUtilizationBuffer(newBuffer)).to.not.be.reverted

      expect(product.updateUtilizationBuffer).to.have.been.calledWith(newBuffer)
    })

    it('reverts if values exceed limits', async () => {
      await coordinatorDel.updateUtilizationBufferLimits({ min: utils.parseEther('0.5'), max: utils.parseEther('0.6') })
      await expect(coordinatorDel.connect(signer).updateUtilizationBuffer(utils.parseEther('0.4')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.4'))
      await expect(coordinatorDel.connect(signer).updateUtilizationBuffer(utils.parseEther('0.7')))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUFixed18UpdateError')
        .withArgs(utils.parseEther('0.7'))
    })
  })

  describe('#updateUtilizationCurve', async () => {
    it('updates the value', async () => {
      const newCurve = {
        minRate: utils.parseEther('0.01'),
        maxRate: utils.parseEther('1'),
        targetRate: utils.parseEther('0.5'),
        targetUtilization: utils.parseEther('0.8'),
      }
      product.updateUtilizationCurve.whenCalledWith(newCurve).returns()

      await expect(coordinatorDel.connect(signer).updateUtilizationCurve(newCurve)).to.not.be.reverted

      expect(product.updateUtilizationCurve).to.have.been.calledWith(newCurve)
    })

    it('reverts if values exceed limits', async () => {
      await coordinatorDel.updateUtilizationCurveLimits({
        minMinRate: utils.parseEther('0.1'),
        maxMinRate: utils.parseEther('0.2'),
        minMaxRate: utils.parseEther('0.5'),
        maxMaxRate: utils.parseEther('0.6'),
        minTargetRate: utils.parseEther('0.3'),
        maxTargetRate: utils.parseEther('0.4'),
        minTargetUtilization: utils.parseEther('0.7'),
        maxTargetUtilization: utils.parseEther('0.8'),
      })
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.05'),
          maxRate: utils.parseEther('0.5'),
          targetRate: utils.parseEther('0.3'),
          targetUtilization: utils.parseEther('0.8'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.21'),
          maxRate: utils.parseEther('0.5'),
          targetRate: utils.parseEther('0.3'),
          targetUtilization: utils.parseEther('0.8'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.1'),
          maxRate: utils.parseEther('0.49'),
          targetRate: utils.parseEther('0.3'),
          targetUtilization: utils.parseEther('0.8'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.1'),
          maxRate: utils.parseEther('0.61'),
          targetRate: utils.parseEther('0.3'),
          targetUtilization: utils.parseEther('0.8'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.1'),
          maxRate: utils.parseEther('0.5'),
          targetRate: utils.parseEther('0.29'),
          targetUtilization: utils.parseEther('0.8'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.1'),
          maxRate: utils.parseEther('0.5'),
          targetRate: utils.parseEther('0.41'),
          targetUtilization: utils.parseEther('0.8'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.1'),
          maxRate: utils.parseEther('0.5'),
          targetRate: utils.parseEther('0.3'),
          targetUtilization: utils.parseEther('0.69'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
      await expect(
        coordinatorDel.connect(signer).updateUtilizationCurve({
          minRate: utils.parseEther('0.1'),
          maxRate: utils.parseEther('0.5'),
          targetRate: utils.parseEther('0.3'),
          targetUtilization: utils.parseEther('0.81'),
        }),
      ).to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableInvalidUtilizationCurveUpdateError')
    })
  })
}

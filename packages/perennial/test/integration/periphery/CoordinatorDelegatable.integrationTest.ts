import { expect } from 'chai'
import 'hardhat'
import { constants, utils } from 'ethers'

import { InstanceVars, deployProtocol, createProduct } from '../helpers/setupHelpers'
import {
  CoordinatorDelegatable,
  CoordinatorDelegatable__factory,
  Product,
  ProxyAdmin,
  TransparentUpgradeableProxy,
  TransparentUpgradeableProxy__factory,
} from '../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'

describe('CoordinatorDelegatable', () => {
  let instanceVars: InstanceVars
  let owner: SignerWithAddress
  let delegate: SignerWithAddress
  let noaccess: SignerWithAddress
  let proxyAdmin: ProxyAdmin
  let product: Product
  let impl: CoordinatorDelegatable
  let proxy: TransparentUpgradeableProxy
  let coordinatorDel: CoordinatorDelegatable

  beforeEach(async () => {
    instanceVars = await deployProtocol()

    const controller = instanceVars.controller
    owner = instanceVars.owner
    delegate = instanceVars.user
    noaccess = instanceVars.userB
    proxyAdmin = instanceVars.proxyAdmin
    product = await createProduct(instanceVars)
    impl = await new CoordinatorDelegatable__factory(owner).deploy()
    proxy = await new TransparentUpgradeableProxy__factory(proxyAdmin.signer).deploy(
      impl.address,
      proxyAdmin.address,
      '0x',
    )
    coordinatorDel = CoordinatorDelegatable__factory.connect(proxy.address, owner)
    await controller.updateCoordinatorPendingOwner(await controller.coordinatorFor(product.address), proxy.address)
  })

  describe('deployment', () => {
    it('deploys the impl behind a proxy', async () => {
      expect(await proxy.connect(proxyAdmin.address).callStatic.admin()).to.equal(proxyAdmin.address)
      expect(await proxy.connect(proxyAdmin.address).callStatic.implementation()).to.equal(impl.address)
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
      const fn = instanceVars.controller.interface.encodeFunctionData('acceptCoordinatorOwner', [1])
      await expect(coordinatorDel.execute(instanceVars.controller.address, fn, 0)).to.not.be.reverted

      expect(await instanceVars.controller['owner(uint256)'](1)).to.equal(proxy.address)
      expect(await instanceVars.controller.coordinatorFor(product.address)).to.equal(1)

      await expect(coordinatorDel.execute(owner.address, '0x', 0)).to.not.be.reverted
    })

    it('can grant and revoke param admin role', async () => {
      await expect(coordinatorDel.updateParamAdmin(delegate.address)).to.not.be.reverted
      expect(await coordinatorDel.paramAdmin()).to.equal(delegate.address)

      await expect(coordinatorDel.updateParamAdmin(constants.AddressZero)).to.not.be.reverted
      expect(await coordinatorDel.paramAdmin()).to.equal(constants.AddressZero)
    })

    context('as product owner', () => {
      beforeEach(async () => {
        const acceptOwnerData = instanceVars.controller.interface.encodeFunctionData('acceptCoordinatorOwner', [1])
        await coordinatorDel.execute(instanceVars.controller.address, acceptOwnerData, 0)
      })

      itPerformsProductUpdates(() => [coordinatorDel, owner, product])
    })
  })

  describe('paramAdmin', () => {
    beforeEach(async () => {
      await coordinatorDel.initialize()

      const acceptOwnerData = instanceVars.controller.interface.encodeFunctionData('acceptCoordinatorOwner', [1])
      await coordinatorDel.execute(instanceVars.controller.address, acceptOwnerData, 0)

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
      await expect(coordinatorDel.connect(noaccess).updateFundingFee(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateMakerFee(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updateTakerFee(product.address, 0))
        .to.be.revertedWithCustomError(coordinatorDel, 'CoordinatorDelegatableNotParamAdminError')
        .withArgs(noaccess.address)
      await expect(coordinatorDel.connect(noaccess).updatePositionFee(product.address, 0))
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
      const proxyAdminSigner = await impersonateWithBalance(proxyAdmin.address, utils.parseEther('1'))
      proxy = proxy.connect(proxyAdminSigner)
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

function itPerformsProductUpdates(getParams: () => [CoordinatorDelegatable, SignerWithAddress, Product]) {
  let coordinatorDel: CoordinatorDelegatable
  let signer: SignerWithAddress
  let product: Product

  beforeEach(() => {
    ;[coordinatorDel, signer, product] = getParams()
  })

  it('can call updateMaintenance', async () => {
    const newMaintenance = utils.parseEther('0.025')

    await expect(coordinatorDel.connect(signer).updateMaintenance(product.address, newMaintenance)).to.not.be.reverted

    expect(await product['maintenance()']()).to.equal(newMaintenance)
  })

  it('can call updateFundingFee', async () => {
    const newFundingFee = utils.parseEther('0.234')

    await expect(coordinatorDel.connect(signer).updateFundingFee(product.address, newFundingFee)).to.not.be.reverted

    expect(await product.fundingFee()).to.equal(newFundingFee)
  })

  it('can call updateMakerFee', async () => {
    const newMakerFee = utils.parseEther('0.00567')

    await expect(coordinatorDel.connect(signer).updateMakerFee(product.address, newMakerFee)).to.not.be.reverted

    expect(await product.makerFee()).to.equal(newMakerFee)
  })

  it('can call updateTakerFee', async () => {
    const newTakerFee = utils.parseEther('0.012')

    await expect(coordinatorDel.connect(signer).updateTakerFee(product.address, newTakerFee)).to.not.be.reverted

    expect(await product.takerFee()).to.equal(newTakerFee)
  })

  it('can call updatePositionFee', async () => {
    const newPositionFee = utils.parseEther('0.1')

    await expect(coordinatorDel.connect(signer).updatePositionFee(product.address, newPositionFee)).to.not.be.reverted

    expect(await product.positionFee()).to.equal(newPositionFee)
  })

  it('can call updateMakerLimit', async () => {
    const newMakerLimit = utils.parseEther('12345')

    await expect(coordinatorDel.connect(signer).updateMakerLimit(product.address, newMakerLimit)).to.not.be.reverted

    expect(await product.makerLimit()).to.equal(newMakerLimit)
  })

  it('can call updateUtilizationCurve', async () => {
    const newCurve = {
      minRate: utils.parseEther('0.01'),
      maxRate: utils.parseEther('1'),
      targetRate: utils.parseEther('0.5'),
      targetUtilization: utils.parseEther('0.8'),
    }

    await expect(coordinatorDel.connect(signer).updateUtilizationCurve(product.address, newCurve)).to.not.be.reverted

    const updatedCurve = await product.utilizationCurve()
    expect(updatedCurve.minRate).to.equal(newCurve.minRate)
    expect(updatedCurve.maxRate).to.equal(newCurve.maxRate)
    expect(updatedCurve.targetRate).to.equal(newCurve.targetRate)
    expect(updatedCurve.targetUtilization).to.equal(newCurve.targetUtilization)
  })
}

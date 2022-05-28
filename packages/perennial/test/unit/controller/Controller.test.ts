import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import {
  Controller,
  Product,
  Collateral__factory,
  Controller__factory,
  Product__factory,
  Incentivizer__factory,
  IProductProvider__factory,
  IBeacon__factory,
} from '../../../types/generated'

const { ethers } = HRE

describe('Controller', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let pendingOwner: SignerWithAddress
  let treasury: SignerWithAddress
  let pauser: SignerWithAddress
  let coordinatorOwner: SignerWithAddress
  let coordinatorPendingOwner: SignerWithAddress
  let coordinatorTreasury: SignerWithAddress
  let coordinatorPauser: SignerWithAddress
  let collateral: MockContract
  let productProvider: MockContract
  let incentivizer: MockContract
  let productBeacon: MockContract

  let controller: Controller
  let productImpl: Product

  beforeEach(async () => {
    ;[
      user,
      owner,
      pendingOwner,
      treasury,
      pauser,
      coordinatorOwner,
      coordinatorPendingOwner,
      coordinatorTreasury,
      coordinatorPauser,
    ] = await ethers.getSigners()
    collateral = await waffle.deployMockContract(owner, Collateral__factory.abi)
    productProvider = await waffle.deployMockContract(owner, IProductProvider__factory.abi)
    incentivizer = await waffle.deployMockContract(owner, Incentivizer__factory.abi)

    productBeacon = await waffle.deployMockContract(owner, IBeacon__factory.abi)
    productImpl = await new Product__factory(owner).deploy()
    await productBeacon.mock.implementation.withArgs().returns(productImpl.address)

    controller = await new Controller__factory(owner).deploy()
    await controller.initialize(collateral.address, incentivizer.address, productBeacon.address)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)

      expect(await controller.collateral()).to.equal(collateral.address)
      expect(await controller.incentivizer()).to.equal(incentivizer.address)
      expect(await controller.productBeacon()).to.equal(productBeacon.address)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['treasury()']()).to.equal(owner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
      expect(await controller['pauser()']()).to.equal(owner.address)
      expect(await controller['pauser(uint256)'](0)).to.equal(owner.address)
      expect(await controller['paused()']()).to.equal(false)
      expect(await controller['paused(uint256)'](0)).to.equal(false)
      expect(await controller.protocolFee()).to.equal(0)
      expect(await controller.minFundingFee()).to.equal(0)
      expect(await controller.liquidationFee()).to.equal(0)
      expect(await controller.incentivizationFee()).to.equal(0)
      expect(await controller.minCollateral()).to.equal(0)
      expect(await controller.programsPerProduct()).to.equal(0)
    })

    it('reverts if already initialized', async () => {
      await expect(
        controller.initialize(collateral.address, incentivizer.address, productBeacon.address),
      ).to.be.revertedWith('UInitializableAlreadyInitializedError(1)')
    })
  })

  describe('#createCoordinator', async () => {
    it('creates the coordinator', async () => {
      const returnValue = await controller.connect(owner).callStatic.createCoordinator(coordinatorOwner.address)
      await expect(controller.connect(owner).createCoordinator(coordinatorOwner.address))
        .to.emit(controller, 'CoordinatorCreated')
        .withArgs(1, coordinatorOwner.address)

      const coordinator = await controller.coordinators(1)

      expect(returnValue).to.equal(1)
      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(coordinatorOwner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['paused(uint256)'](1)).to.equal(false)
    })

    it('reverts if not protocol owner', async () => {
      await expect(controller.connect(coordinatorOwner).createCoordinator(coordinatorOwner.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateCoordinatorPendingOwner', async () => {
    beforeEach(async () => {
      await controller.connect(owner).createCoordinator(coordinatorOwner.address)
    })

    it('updates the coordinator pending owner', async () => {
      await expect(
        controller.connect(coordinatorOwner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address),
      )
        .to.emit(controller, 'CoordinatorPendingOwnerUpdated')
        .withArgs(1, coordinatorPendingOwner.address)

      const coordinator = await controller.coordinators(1)

      expect(coordinator.pendingOwner).to.equal(coordinatorPendingOwner.address)
      expect(coordinator.owner).to.equal(coordinatorOwner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['paused(uint256)'](1)).to.equal(false)
    })

    it('updates the coordinator pending owner (protocol)', async () => {
      await expect(controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address))
        .to.emit(controller, 'CoordinatorPendingOwnerUpdated')
        .withArgs(0, pendingOwner.address)

      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(pendingOwner.address)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner()']()).to.equal(pendingOwner.address)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(pendingOwner.address)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['treasury()']()).to.equal(owner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
      expect(await controller['pauser()']()).to.equal(owner.address)
      expect(await controller['pauser(uint256)'](0)).to.equal(owner.address)
      expect(await controller['paused()']()).to.equal(false)
      expect(await controller['paused(uint256)'](0)).to.equal(false)
    })

    it('reverts if not owner', async () => {
      await expect(
        controller.connect(owner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address),
      ).to.be.revertedWith('ControllerNotOwnerError(1)')
    })

    it('reverts if not owner (protocol)', async () => {
      await expect(controller.connect(user).updateCoordinatorTreasury(0, pendingOwner.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#acceptCoordinatorOwner', async () => {
    beforeEach(async () => {
      await controller.connect(owner).createCoordinator(coordinatorOwner.address)
    })

    it('updates the coordinator owner', async () => {
      await controller.connect(coordinatorOwner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address)

      await expect(controller.connect(coordinatorPendingOwner).acceptCoordinatorOwner(1))
        .to.emit(controller, 'CoordinatorOwnerUpdated')
        .withArgs(1, coordinatorPendingOwner.address)

      const coordinator = await controller.coordinators(1)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(coordinatorPendingOwner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
      expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
      expect(await controller['paused(uint256)'](1)).to.equal(false)
    })

    it('updates the coordinator owner (protocol)', async () => {
      await controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address)

      await expect(controller.connect(pendingOwner).acceptCoordinatorOwner(0))
        .to.emit(controller, 'CoordinatorOwnerUpdated')
        .withArgs(0, pendingOwner.address)

      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(pendingOwner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner()']()).to.equal(pendingOwner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(pendingOwner.address)
      expect(await controller['treasury()']()).to.equal(pendingOwner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(pendingOwner.address)
      expect(await controller['pauser()']()).to.equal(pendingOwner.address)
      expect(await controller['pauser(uint256)'](0)).to.equal(pendingOwner.address)
      expect(await controller['paused()']()).to.equal(false)
      expect(await controller['paused(uint256)'](0)).to.equal(false)
    })

    it('reverts if owner', async () => {
      await controller.connect(coordinatorOwner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address)

      await expect(controller.connect(coordinatorOwner).acceptCoordinatorOwner(1)).to.be.revertedWith(
        'ControllerNotPendingOwnerError(1)',
      )
    })

    it('reverts if not pending owner (unrelated)', async () => {
      await controller.connect(coordinatorOwner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address)

      await expect(controller.connect(coordinatorPauser).acceptCoordinatorOwner(1)).to.be.revertedWith(
        'ControllerNotPendingOwnerError(1)',
      )
    })

    it('reverts if owner (protocol)', async () => {
      await controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address)

      await expect(controller.connect(owner).acceptCoordinatorOwner(0)).to.be.revertedWith(
        'ControllerNotPendingOwnerError(0)',
      )
    })

    it('reverts if not pending owner (unrelated) (protocol)', async () => {
      await controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address)

      await expect(controller.connect(pauser).acceptCoordinatorOwner(0)).to.be.revertedWith(
        'ControllerNotPendingOwnerError(0)',
      )
    })
  })

  describe('#updateCoordinatorTreasury', async () => {
    beforeEach(async () => {
      await controller.connect(owner).createCoordinator(coordinatorOwner.address)
    })

    it('updates the coordinator treasury', async () => {
      await expect(controller.connect(coordinatorOwner).updateCoordinatorTreasury(1, coordinatorTreasury.address))
        .to.emit(controller, 'CoordinatorTreasuryUpdated')
        .withArgs(1, coordinatorTreasury.address)

      const coordinator = await controller.coordinators(1)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(coordinatorOwner.address)
      expect(coordinator.treasury).to.equal(coordinatorTreasury.address)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorTreasury.address)
      expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['paused(uint256)'](1)).to.equal(false)
    })

    it('updates the coordinator treasury (protocol)', async () => {
      await expect(controller.connect(owner).updateCoordinatorTreasury(0, treasury.address))
        .to.emit(controller, 'CoordinatorTreasuryUpdated')
        .withArgs(0, treasury.address)

      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(treasury.address)
      expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['treasury()']()).to.equal(treasury.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(treasury.address)
      expect(await controller['pauser()']()).to.equal(owner.address)
      expect(await controller['pauser(uint256)'](0)).to.equal(owner.address)
      expect(await controller['paused()']()).to.equal(false)
      expect(await controller['paused(uint256)'](0)).to.equal(false)
    })

    it('reverts if not owner', async () => {
      await expect(
        controller.connect(owner).updateCoordinatorTreasury(1, coordinatorTreasury.address),
      ).to.be.revertedWith('ControllerNotOwnerError(1)')
    })

    it('reverts if not owner (protocol)', async () => {
      await expect(controller.connect(user).updateCoordinatorTreasury(0, treasury.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateCoordinatorPauser', async () => {
    beforeEach(async () => {
      await controller.connect(owner).createCoordinator(coordinatorOwner.address)
    })

    it('updates the coordinator pauser', async () => {
      await expect(controller.connect(coordinatorOwner).updateCoordinatorPauser(1, coordinatorPauser.address))
        .to.emit(controller, 'CoordinatorPauserUpdated')
        .withArgs(1, coordinatorPauser.address)

      const coordinator = await controller.coordinators(1)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(coordinatorOwner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(coordinatorPauser.address)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorPauser.address)
      expect(await controller['paused(uint256)'](1)).to.equal(false)
    })

    it('updates the coordinator pauser (protocol)', async () => {
      await expect(controller.connect(owner).updateCoordinatorPauser(0, pauser.address))
        .to.emit(controller, 'CoordinatorPauserUpdated')
        .withArgs(0, pauser.address)

      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(coordinator.pauser).to.equal(pauser.address)
      expect(coordinator.paused).to.equal(false)
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['treasury()']()).to.equal(owner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
      expect(await controller['pauser()']()).to.equal(pauser.address)
      expect(await controller['pauser(uint256)'](0)).to.equal(pauser.address)
      expect(await controller['paused()']()).to.equal(false)
      expect(await controller['paused(uint256)'](0)).to.equal(false)
    })

    it('reverts if not owner', async () => {
      await expect(controller.connect(owner).updateCoordinatorPauser(1, coordinatorPauser.address)).to.be.revertedWith(
        'ControllerNotOwnerError(1)',
      )
    })

    it('reverts if not owner (protocol)', async () => {
      await expect(controller.connect(user).updateCoordinatorPauser(0, pauser.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateCoordinatorPaused', async () => {
    beforeEach(async () => {
      await controller.connect(owner).createCoordinator(coordinatorOwner.address)
    })

    context('from owner', async () => {
      it('updates the coordinator paused', async () => {
        await expect(controller.connect(coordinatorOwner).updateCoordinatorPaused(1, true))
          .to.emit(controller, 'CoordinatorPausedUpdated')
          .withArgs(1, true)

        const coordinator = await controller.coordinators(1)

        expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
        expect(coordinator.owner).to.equal(coordinatorOwner.address)
        expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
        expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
        expect(coordinator.paused).to.equal(true)
        expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
        expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
        expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
        expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorOwner.address)
        expect(await controller['paused(uint256)'](1)).to.equal(true)
      })

      it('updates the coordinator paused (protocol)', async () => {
        await expect(controller.connect(owner).updateCoordinatorPaused(0, true))
          .to.emit(controller, 'CoordinatorPausedUpdated')
          .withArgs(0, true)

        const coordinator = await controller.coordinators(0)

        expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
        expect(coordinator.owner).to.equal(owner.address)
        expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
        expect(coordinator.pauser).to.equal(ethers.constants.AddressZero)
        expect(coordinator.paused).to.equal(true)
        expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
        expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
        expect(await controller['owner()']()).to.equal(owner.address)
        expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
        expect(await controller['treasury()']()).to.equal(owner.address)
        expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
        expect(await controller['pauser()']()).to.equal(owner.address)
        expect(await controller['pauser(uint256)'](0)).to.equal(owner.address)
        expect(await controller['paused()']()).to.equal(true)
        expect(await controller['paused(uint256)'](0)).to.equal(true)
        expect(await controller['paused(uint256)'](1)).to.equal(true)
      })

      it('reverts if not owner', async () => {
        await expect(controller.connect(owner).updateCoordinatorPaused(1, true)).to.be.revertedWith(
          'ControllerNotPauserError(1)',
        )
      })

      it('reverts if not owner (protocol)', async () => {
        await expect(controller.connect(user).updateCoordinatorPaused(0, true)).to.be.revertedWith(
          'ControllerNotPauserError(0)',
        )
      })
    })

    context('from pauser', async () => {
      it('updates the coordinator paused', async () => {
        await controller.connect(coordinatorOwner).updateCoordinatorPauser(1, coordinatorPauser.address)

        await expect(controller.connect(coordinatorPauser).updateCoordinatorPaused(1, true))
          .to.emit(controller, 'CoordinatorPausedUpdated')
          .withArgs(1, true)

        const coordinator = await controller.coordinators(1)

        expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
        expect(coordinator.owner).to.equal(coordinatorOwner.address)
        expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
        expect(coordinator.pauser).to.equal(coordinatorPauser.address)
        expect(coordinator.paused).to.equal(true)
        expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
        expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
        expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
        expect(await controller['pauser(uint256)'](1)).to.equal(coordinatorPauser.address)
        expect(await controller['paused(uint256)'](1)).to.equal(true)
      })

      it('updates the coordinator paused (protocol)', async () => {
        await controller.connect(owner).updateCoordinatorPauser(0, pauser.address)

        await expect(controller.connect(pauser).updateCoordinatorPaused(0, true))
          .to.emit(controller, 'CoordinatorPausedUpdated')
          .withArgs(0, true)

        const coordinator = await controller.coordinators(0)

        expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
        expect(coordinator.owner).to.equal(owner.address)
        expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
        expect(coordinator.pauser).to.equal(pauser.address)
        expect(coordinator.paused).to.equal(true)
        expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
        expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
        expect(await controller['owner()']()).to.equal(owner.address)
        expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
        expect(await controller['treasury()']()).to.equal(owner.address)
        expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
        expect(await controller['pauser()']()).to.equal(pauser.address)
        expect(await controller['pauser(uint256)'](0)).to.equal(pauser.address)
        expect(await controller['paused()']()).to.equal(true)
        expect(await controller['paused(uint256)'](0)).to.equal(true)
      })

      it('reverts if not owner', async () => {
        await expect(controller.connect(owner).updateCoordinatorPaused(1, true)).to.be.revertedWith(
          'ControllerNotPauserError(1)',
        )
      })

      it('reverts if not owner (protocol)', async () => {
        await expect(controller.connect(user).updateCoordinatorPaused(0, true)).to.be.revertedWith(
          'ControllerNotPauserError(0)',
        )
      })
    })
  })

  describe('#createProduct', async () => {
    beforeEach(async () => {
      await controller.connect(owner).createCoordinator(coordinatorOwner.address)
      await controller.connect(coordinatorOwner).updateCoordinatorTreasury(1, coordinatorTreasury.address)
      await controller.connect(coordinatorOwner).updateCoordinatorPauser(1, coordinatorPauser.address)
    })

    it('creates the product', async () => {
      const productAddress = await controller.connect(owner).callStatic.createProduct(1, productProvider.address)
      await expect(controller.connect(owner).createProduct(1, productProvider.address))
        .to.emit(controller, 'ProductCreated')
        .withArgs(productAddress, productProvider.address)

      const productInstance = Product__factory.connect(productAddress, owner)
      expect(await productInstance.controller()).to.equal(controller.address)

      expect(await controller.coordinatorFor(productAddress)).to.equal(1)
      expect(await controller.isProduct(productAddress)).to.equal(true)
      expect(await controller['owner(address)'](productAddress)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(address)'](productAddress)).to.equal(coordinatorTreasury.address)
      expect(await controller['pauser(address)'](productAddress)).to.equal(coordinatorPauser.address)
      expect(await controller['paused(address)'](productAddress)).to.equal(false)
    })

    it('reverts if zero coordinator', async () => {
      await expect(controller.connect(owner).createProduct(0, productProvider.address)).to.be.revertedWith(
        'ControllerNoZeroCoordinatorError()',
      )
    })

    it('reverts if not protocol owner', async () => {
      await expect(controller.connect(coordinatorOwner).createProduct(1, productProvider.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })

    it('returns paused correctly', async () => {
      const productAddress = await controller.connect(owner).callStatic.createProduct(1, productProvider.address)
      await controller.connect(owner).createProduct(1, productProvider.address)

      await controller.connect(coordinatorPauser).updateCoordinatorPaused(1, true)
      expect(await controller['paused(address)'](productAddress)).to.equal(true)
    })
  })

  describe('#updateCollateral', async () => {
    it('updates the collateral address', async () => {
      const newCollateral = await waffle.deployMockContract(owner, Collateral__factory.abi)
      await expect(controller.updateCollateral(newCollateral.address))
        .to.emit(controller, 'CollateralUpdated')
        .withArgs(newCollateral.address)

      expect(await controller.collateral()).to.equal(newCollateral.address)
    })

    it('reverts if not owner', async () => {
      const newCollateral = await waffle.deployMockContract(owner, Collateral__factory.abi)
      await expect(controller.connect(user).updateCollateral(newCollateral.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateIncentivizer', async () => {
    it('updates the collateral address', async () => {
      const newIncentivizer = await waffle.deployMockContract(owner, Incentivizer__factory.abi)
      await expect(controller.updateIncentivizer(newIncentivizer.address))
        .to.emit(controller, 'IncentivizerUpdated')
        .withArgs(newIncentivizer.address)

      expect(await controller.incentivizer()).to.equal(newIncentivizer.address)
    })

    it('reverts if not owner', async () => {
      const newIncentivizer = await waffle.deployMockContract(owner, Incentivizer__factory.abi)
      await expect(controller.connect(user).updateIncentivizer(newIncentivizer.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateproductBeacon', async () => {
    it('updates the collateral address', async () => {
      const newProductBeacon = await waffle.deployMockContract(owner, IBeacon__factory.abi)
      await expect(controller.updateProductBeacon(newProductBeacon.address))
        .to.emit(controller, 'ProductBeaconUpdated')
        .withArgs(newProductBeacon.address)

      expect(await controller.productBeacon()).to.equal(newProductBeacon.address)
    })

    it('reverts if not owner', async () => {
      const newProductBeacon = await waffle.deployMockContract(owner, IBeacon__factory.abi)
      await expect(controller.connect(user).updateProductBeacon(newProductBeacon.address)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateProtocolFee', async () => {
    it('updates the collateral address', async () => {
      const newProtocolFee = utils.parseEther('0.5')
      await expect(controller.updateProtocolFee(newProtocolFee))
        .to.emit(controller, 'ProtocolFeeUpdated')
        .withArgs(newProtocolFee)

      expect(await controller.protocolFee()).to.equal(newProtocolFee)
    })

    it('reverts if not owner', async () => {
      const newProtocolFee = utils.parseEther('0.5')
      await expect(controller.connect(user).updateProtocolFee(newProtocolFee)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })

    it('reverts if too large', async () => {
      const newProtocolFee = utils.parseEther('1.05')
      await expect(controller.connect(owner).updateProtocolFee(newProtocolFee)).to.be.revertedWith(
        'ControllerInvalidProtocolFeeError()',
      )
    })
  })

  describe('#updateMinFundingFee', async () => {
    it('updates the collateral address', async () => {
      const newMinFundingFee = utils.parseEther('0.1')
      await expect(controller.updateMinFundingFee(newMinFundingFee))
        .to.emit(controller, 'MinFundingFeeUpdated')
        .withArgs(newMinFundingFee)

      expect(await controller.minFundingFee()).to.equal(newMinFundingFee)
    })

    it('reverts if not owner', async () => {
      const newMinFundingFee = utils.parseEther('0.1')
      await expect(controller.connect(user).updateMinFundingFee(newMinFundingFee)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })

    it('reverts if too large', async () => {
      const newMinFundingFee = utils.parseEther('1.05')
      await expect(controller.connect(owner).updateMinFundingFee(newMinFundingFee)).to.be.revertedWith(
        'ControllerInvalidMinFundingFeeError()',
      )
    })
  })

  describe('#updateLiquidationFee', async () => {
    it('updates the liquidation fee', async () => {
      const newLiquidationFee = utils.parseEther('0.05')
      await expect(controller.updateLiquidationFee(newLiquidationFee))
        .to.emit(controller, 'LiquidationFeeUpdated')
        .withArgs(newLiquidationFee)

      expect(await controller.liquidationFee()).to.equal(newLiquidationFee)
    })

    it('reverts if not owner', async () => {
      const newLiquidationFee = utils.parseEther('0.05')
      await expect(controller.connect(user).updateLiquidationFee(newLiquidationFee)).to.be.revertedWith(
        `ControllerNotOwnerError(0)`,
      )
    })

    it('reverts if too large', async () => {
      const newLiquidationFee = utils.parseEther('1.05')
      await expect(controller.connect(owner).updateLiquidationFee(newLiquidationFee)).to.be.revertedWith(
        `ControllerInvalidLiquidationFeeError()`,
      )
    })
  })

  describe('#updateIncentivizationFee', async () => {
    it('updates the programs per product', async () => {
      await expect(controller.connect(owner).updateIncentivizationFee(utils.parseEther('0.02')))
        .to.emit(controller, 'IncentivizationFeeUpdated')
        .withArgs(utils.parseEther('0.02'))

      expect(await controller.incentivizationFee()).to.equal(utils.parseEther('0.02'))
    })

    it('reverts if not owner', async () => {
      await expect(controller.connect(user).updateIncentivizationFee(utils.parseEther('0.02'))).to.be.revertedWith(
        `ControllerNotOwnerError(0)`,
      )
    })

    it('reverts if too large', async () => {
      await expect(controller.connect(owner).updateIncentivizationFee(utils.parseEther('1.05'))).to.be.revertedWith(
        `ControllerInvalidIncentivizationFeeError()`,
      )
    })
  })

  describe('#updateMinCollateral', async () => {
    it('updates the collateral address', async () => {
      const newMinCollateral = utils.parseEther('1000')
      await expect(controller.updateMinCollateral(newMinCollateral))
        .to.emit(controller, 'MinCollateralUpdated')
        .withArgs(newMinCollateral)

      expect(await controller.minCollateral()).to.equal(newMinCollateral)
    })

    it('reverts if not owner', async () => {
      const newMinCollateral = utils.parseEther('1000')
      await expect(controller.connect(user).updateMinCollateral(newMinCollateral)).to.be.revertedWith(
        'ControllerNotOwnerError(0)',
      )
    })
  })

  describe('#updateProgramsPerProduct', async () => {
    it('updates the programs per product', async () => {
      await expect(controller.connect(owner).updateProgramsPerProduct(3))
        .to.emit(controller, 'ProgramsPerProductUpdated')
        .withArgs(3)

      expect(await controller.programsPerProduct()).to.equal(3)
    })

    it('reverts if not owner', async () => {
      await expect(controller.connect(user).updateProgramsPerProduct(3)).to.be.revertedWith(
        `ControllerNotOwnerError(0)`,
      )
    })
  })
})

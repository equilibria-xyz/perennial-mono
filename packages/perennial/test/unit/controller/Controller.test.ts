import { MockContract, deployMockContract } from '@ethereum-waffle/mock-contract'
import { constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  Controller,
  Product,
  Collateral__factory,
  Controller__factory,
  Product__factory,
  Incentivizer__factory,
  MultiInvoker__factory,
  IContractPayoffProvider__factory,
  IBeacon__factory,
  IOracleProvider__factory,
} from '../../../types/generated'
import { createPayoffDefinition } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

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
  let payoffProvider: MockContract
  let oracle: MockContract
  let incentivizer: MockContract
  let productBeacon: MockContract
  let multiInvoker: MockContract

  let controller: Controller
  let productImpl: Product

  const controllerFixture = async () => {
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
    collateral = await deployMockContract(owner, Collateral__factory.abi)
    payoffProvider = await deployMockContract(owner, IContractPayoffProvider__factory.abi)
    oracle = await deployMockContract(owner, IOracleProvider__factory.abi)
    incentivizer = await deployMockContract(owner, Incentivizer__factory.abi)
    multiInvoker = await deployMockContract(owner, MultiInvoker__factory.abi)

    productBeacon = await deployMockContract(owner, IBeacon__factory.abi)
    productImpl = await new Product__factory(owner).deploy()
    await productBeacon.mock.implementation.withArgs().returns(productImpl.address)

    controller = await new Controller__factory(owner).deploy()
    await controller.initialize(collateral.address, incentivizer.address, productBeacon.address)
    await controller.updateMultiInvoker(multiInvoker.address)
  }

  beforeEach(async () => {
    await loadFixture(controllerFixture)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)

      expect(await controller.collateral()).to.equal(collateral.address)
      expect(await controller.incentivizer()).to.equal(incentivizer.address)
      expect(await controller.productBeacon()).to.equal(productBeacon.address)
      expect(await controller.multiInvoker()).to.equal(multiInvoker.address)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['treasury()']()).to.equal(owner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
      expect(await controller.pauser()).to.equal(owner.address)
      expect(await controller.paused()).to.equal(false)
      expect(await controller.protocolFee()).to.equal(0)
      expect(await controller.minFundingFee()).to.equal(0)
      expect(await controller.liquidationFee()).to.equal(0)
      expect(await controller.incentivizationFee()).to.equal(0)
      expect(await controller.minCollateral()).to.equal(0)
      expect(await controller.programsPerProduct()).to.equal(0)
    })

    it('reverts if already initialized', async () => {
      await expect(controller.initialize(collateral.address, incentivizer.address, productBeacon.address))
        .to.be.revertedWithCustomError(controller, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#createCoordinator', async () => {
    it('creates the coordinator', async () => {
      const returnValue = await controller.connect(coordinatorOwner).callStatic.createCoordinator()
      await expect(controller.connect(coordinatorOwner).createCoordinator())
        .to.emit(controller, 'CoordinatorCreated')
        .withArgs(1, coordinatorOwner.address)

      const coordinator = await controller.coordinators(1)

      expect(returnValue).to.equal(1)
      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(coordinatorOwner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
    })
  })

  describe('#updateCoordinatorPendingOwner', async () => {
    const fixture = async () => {
      await controller.connect(coordinatorOwner).createCoordinator()
    }

    beforeEach(async () => {
      await loadFixture(fixture)
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
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorOwner.address)
    })

    it('updates the coordinator pending owner (protocol)', async () => {
      await expect(controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address))
        .to.emit(controller, 'CoordinatorPendingOwnerUpdated')
        .withArgs(0, pendingOwner.address)

      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(pendingOwner.address)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner()']()).to.equal(pendingOwner.address)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(pendingOwner.address)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['treasury()']()).to.equal(owner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(owner.address)
    })

    it('reverts if not owner', async () => {
      await expect(controller.connect(owner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(1)
    })

    it('reverts if not owner (protocol)', async () => {
      await expect(controller.connect(user).updateCoordinatorTreasury(0, pendingOwner.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })
  })

  describe('#acceptCoordinatorOwner', async () => {
    const fixture = async () => {
      await controller.connect(coordinatorOwner).createCoordinator()
    }

    beforeEach(async () => {
      await loadFixture(fixture)
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
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorPendingOwner.address)
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
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner()']()).to.equal(pendingOwner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(pendingOwner.address)
      expect(await controller['treasury()']()).to.equal(pendingOwner.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(pendingOwner.address)
    })

    it('reverts if owner', async () => {
      await controller.connect(coordinatorOwner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address)

      await expect(controller.connect(coordinatorOwner).acceptCoordinatorOwner(1))
        .to.be.revertedWithCustomError(controller, 'ControllerNotPendingOwnerError')
        .withArgs(1)
    })

    it('reverts if not pending owner (unrelated)', async () => {
      await controller.connect(coordinatorOwner).updateCoordinatorPendingOwner(1, coordinatorPendingOwner.address)

      await expect(controller.connect(coordinatorPauser).acceptCoordinatorOwner(1))
        .to.be.revertedWithCustomError(controller, 'ControllerNotPendingOwnerError')
        .withArgs(1)
    })

    it('reverts if owner (protocol)', async () => {
      await controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address)

      await expect(controller.connect(owner).acceptCoordinatorOwner(0))
        .to.be.revertedWithCustomError(controller, 'ControllerNotPendingOwnerError')
        .withArgs(0)
    })

    it('reverts if not pending owner (unrelated) (protocol)', async () => {
      await controller.connect(owner).updateCoordinatorPendingOwner(0, pendingOwner.address)

      await expect(controller.connect(pauser).acceptCoordinatorOwner(0))
        .to.be.revertedWithCustomError(controller, 'ControllerNotPendingOwnerError')
        .withArgs(0)
    })
  })

  describe('#updateCoordinatorTreasury', async () => {
    const fixture = async () => {
      await controller.connect(coordinatorOwner).createCoordinator()
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('updates the coordinator treasury', async () => {
      await expect(controller.connect(coordinatorOwner).updateCoordinatorTreasury(1, coordinatorTreasury.address))
        .to.emit(controller, 'CoordinatorTreasuryUpdated')
        .withArgs(1, coordinatorTreasury.address)

      const coordinator = await controller.coordinators(1)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(coordinatorOwner.address)
      expect(coordinator.treasury).to.equal(coordinatorTreasury.address)
      expect(await controller['pendingOwner(uint256)'](1)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner(uint256)'](1)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(uint256)'](1)).to.equal(coordinatorTreasury.address)
    })

    it('updates the coordinator treasury (protocol)', async () => {
      await expect(controller.connect(owner).updateCoordinatorTreasury(0, treasury.address))
        .to.emit(controller, 'CoordinatorTreasuryUpdated')
        .withArgs(0, treasury.address)

      const coordinator = await controller.coordinators(0)

      expect(coordinator.pendingOwner).to.equal(ethers.constants.AddressZero)
      expect(coordinator.owner).to.equal(owner.address)
      expect(coordinator.treasury).to.equal(treasury.address)
      expect(await controller['pendingOwner()']()).to.equal(ethers.constants.AddressZero)
      expect(await controller['pendingOwner(uint256)'](0)).to.equal(ethers.constants.AddressZero)
      expect(await controller['owner()']()).to.equal(owner.address)
      expect(await controller['owner(uint256)'](0)).to.equal(owner.address)
      expect(await controller['treasury()']()).to.equal(treasury.address)
      expect(await controller['treasury(uint256)'](0)).to.equal(treasury.address)
    })

    it('reverts if not owner', async () => {
      await expect(controller.connect(owner).updateCoordinatorTreasury(1, coordinatorTreasury.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(1)
    })

    it('reverts if not owner (protocol)', async () => {
      await expect(controller.connect(user).updateCoordinatorTreasury(0, treasury.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })
  })

  describe('#createProduct', async () => {
    const PRODUCT_INFO = {
      name: 'Squeeth',
      symbol: 'SQTH',
      payoffDefinition: createPayoffDefinition(),
      oracle: '',
      maintenance: ethers.constants.Zero,
      fundingFee: ethers.constants.Zero,
      makerFee: ethers.constants.Zero,
      takerFee: ethers.constants.Zero,
      positionFee: ethers.constants.Zero,
      makerLimit: ethers.constants.Zero,
      utilizationCurve: {
        minRate: utils.parseEther('0.10'),
        maxRate: utils.parseEther('0.10'),
        targetRate: utils.parseEther('0.10'),
        targetUtilization: utils.parseEther('1'),
      },
    }
    const fixture = async () => {
      PRODUCT_INFO.payoffDefinition = createPayoffDefinition({ contractAddress: payoffProvider.address })
      PRODUCT_INFO.oracle = oracle.address
      await controller.connect(coordinatorOwner).createCoordinator()
      await controller.connect(coordinatorOwner).updateCoordinatorTreasury(1, coordinatorTreasury.address)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('creates the product', async () => {
      const productAddress = await controller.connect(coordinatorOwner).callStatic.createProduct(1, PRODUCT_INFO)
      await expect(controller.connect(coordinatorOwner).createProduct(1, PRODUCT_INFO))
        .to.emit(controller, 'ProductCreated')
        .withArgs(productAddress, PRODUCT_INFO)

      const productInstance = Product__factory.connect(productAddress, owner)
      expect(await productInstance.controller()).to.equal(controller.address)

      expect(await controller.coordinatorFor(productAddress)).to.equal(1)
      expect(await controller.isProduct(productAddress)).to.equal(true)
      expect(await controller['owner(address)'](productAddress)).to.equal(coordinatorOwner.address)
      expect(await controller['treasury(address)'](productAddress)).to.equal(coordinatorTreasury.address)
    })

    it('reverts if zero coordinator', async () => {
      await expect(controller.connect(owner).createProduct(0, PRODUCT_INFO)).to.be.revertedWithCustomError(
        controller,
        'ControllerNoZeroCoordinatorError',
      )
    })

    it('reverts if not coordinator owner', async () => {
      await expect(controller.connect(owner).createProduct(1, PRODUCT_INFO))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(1)
    })
  })

  describe('#updateCollateral', async () => {
    it('updates the collateral address', async () => {
      const newCollateral = await deployMockContract(owner, Collateral__factory.abi)
      await expect(controller.updateCollateral(newCollateral.address))
        .to.emit(controller, 'CollateralUpdated')
        .withArgs(newCollateral.address)

      expect(await controller.collateral()).to.equal(newCollateral.address)
    })

    it('reverts if not owner', async () => {
      const newCollateral = await deployMockContract(owner, Collateral__factory.abi)
      await expect(controller.connect(user).updateCollateral(newCollateral.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })

    it('reverts on invalid address', async () => {
      await expect(controller.updateCollateral(user.address)).to.be.revertedWithCustomError(
        controller,
        'ControllerNotContractAddressError',
      )
    })
  })

  describe('#updateIncentivizer', async () => {
    it('updates the collateral address', async () => {
      const newIncentivizer = await deployMockContract(owner, Incentivizer__factory.abi)
      await expect(controller.updateIncentivizer(newIncentivizer.address))
        .to.emit(controller, 'IncentivizerUpdated')
        .withArgs(newIncentivizer.address)

      expect(await controller.incentivizer()).to.equal(newIncentivizer.address)
    })

    it('reverts if not owner', async () => {
      const newIncentivizer = await deployMockContract(owner, Incentivizer__factory.abi)
      await expect(controller.connect(user).updateIncentivizer(newIncentivizer.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })

    it('reverts on invalid address', async () => {
      await expect(controller.updateIncentivizer(user.address)).to.be.revertedWithCustomError(
        controller,
        'ControllerNotContractAddressError',
      )
    })
  })

  describe('#updateProductBeacon', async () => {
    it('updates the collateral address', async () => {
      const newProductBeacon = await deployMockContract(owner, IBeacon__factory.abi)
      await expect(controller.updateProductBeacon(newProductBeacon.address))
        .to.emit(controller, 'ProductBeaconUpdated')
        .withArgs(newProductBeacon.address)

      expect(await controller.productBeacon()).to.equal(newProductBeacon.address)
    })

    it('reverts if not owner', async () => {
      const newProductBeacon = await deployMockContract(owner, IBeacon__factory.abi)
      await expect(controller.connect(user).updateProductBeacon(newProductBeacon.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })

    it('reverts on invalid address', async () => {
      await expect(controller.updateProductBeacon(user.address)).to.be.revertedWithCustomError(
        controller,
        'ControllerNotContractAddressError',
      )
    })
  })

  describe('#updateMultiInvoker', async () => {
    it('updates the multiInvoker address', async () => {
      const newMultiInvoker = await deployMockContract(owner, MultiInvoker__factory.abi)
      await expect(controller.updateMultiInvoker(newMultiInvoker.address))
        .to.emit(controller, 'MultiInvokerUpdated')
        .withArgs(newMultiInvoker.address)

      expect(await controller.multiInvoker()).to.equal(newMultiInvoker.address)
    })

    it('reverts if not owner', async () => {
      const newMultiInvoker = await deployMockContract(owner, MultiInvoker__factory.abi)
      await expect(controller.connect(user).updateMultiInvoker(newMultiInvoker.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })

    it('reverts on invalid address', async () => {
      await expect(controller.updateMultiInvoker(user.address)).to.be.revertedWithCustomError(
        controller,
        'ControllerNotContractAddressError',
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
      await expect(controller.connect(user).updateProtocolFee(newProtocolFee))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })

    it('reverts if too large', async () => {
      const newProtocolFee = utils.parseEther('1.05')
      await expect(controller.connect(owner).updateProtocolFee(newProtocolFee)).to.be.revertedWithCustomError(
        controller,
        'ControllerInvalidProtocolFeeError',
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
      await expect(controller.connect(user).updateMinFundingFee(newMinFundingFee))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })

    it('reverts if too large', async () => {
      const newMinFundingFee = utils.parseEther('1.05')
      await expect(controller.connect(owner).updateMinFundingFee(newMinFundingFee)).to.be.revertedWithCustomError(
        controller,
        'ControllerInvalidMinFundingFeeError',
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
      await expect(controller.connect(user).updateLiquidationFee(newLiquidationFee))
        .to.be.revertedWithCustomError(controller, `ControllerNotOwnerError`)
        .withArgs(0)
    })

    it('reverts if too large', async () => {
      const newLiquidationFee = utils.parseEther('1.05')
      await expect(controller.connect(owner).updateLiquidationFee(newLiquidationFee)).to.be.revertedWithCustomError(
        controller,
        `ControllerInvalidLiquidationFeeError`,
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
      await expect(controller.connect(user).updateIncentivizationFee(utils.parseEther('0.02')))
        .to.be.revertedWithCustomError(controller, `ControllerNotOwnerError`)
        .withArgs(0)
    })

    it('reverts if too large', async () => {
      await expect(
        controller.connect(owner).updateIncentivizationFee(utils.parseEther('1.05')),
      ).to.be.revertedWithCustomError(controller, `ControllerInvalidIncentivizationFeeError`)
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
      await expect(controller.connect(user).updateMinCollateral(newMinCollateral))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
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
      await expect(controller.connect(user).updateProgramsPerProduct(3))
        .to.be.revertedWithCustomError(controller, `ControllerNotOwnerError`)
        .withArgs(0)
    })
  })

  describe('#updatePaused', async () => {
    it('updates the protocol paused state', async () => {
      expect(await controller.paused()).to.equal(false)
      await expect(controller.connect(owner).updatePaused(true)).to.emit(controller, 'PausedUpdated').withArgs(true)

      expect(await controller.paused()).to.equal(true)
      await expect(controller.connect(owner).updatePaused(false)).to.emit(controller, 'PausedUpdated').withArgs(false)

      expect(await controller.paused()).to.equal(false)
    })

    it('reverts if not pauser', async () => {
      await expect(controller.connect(user).updatePaused(true)).to.be.revertedWithCustomError(
        controller,
        `ControllerNotPauserError`,
      )
    })
  })

  describe('#updatePauser', async () => {
    it('updates the pauser address', async () => {
      expect(await controller.pauser()).to.equal(owner.address)
      await expect(controller.connect(owner).updatePauser(user.address))
        .to.emit(controller, 'PauserUpdated')
        .withArgs(user.address)
    })

    it('updates the pauser to address(0) to default to owner', async () => {
      await controller.connect(owner).updatePauser(user.address)
      expect(await controller.pauser()).to.equal(user.address)

      await expect(controller.connect(owner).updatePauser(constants.AddressZero))
        .to.emit(controller, 'PauserUpdated')
        .withArgs(constants.AddressZero)

      expect(await controller.pauser()).to.equal(owner.address)
    })

    it('reverts if not owner', async () => {
      await expect(controller.connect(user).updatePauser(user.address))
        .to.be.revertedWithCustomError(controller, 'ControllerNotOwnerError')
        .withArgs(0)
    })
  })

  context('invalid product', () => {
    describe('#treasury(IProduct product)', () => {
      it('reverts', async () => {
        await expect(controller['treasury(address)'](constants.AddressZero)).to.be.revertedWithCustomError(
          controller,
          'ControllerNotProductError',
        )
      })
    })

    describe('#owner(IProduct product)', () => {
      it('reverts', async () => {
        await expect(controller['owner(address)'](constants.AddressZero)).to.be.revertedWithCustomError(
          controller,
          'ControllerNotProductError',
        )
      })
    })
  })
})

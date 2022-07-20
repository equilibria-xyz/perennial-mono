import { MockContract } from '@ethereum-waffle/mock-contract'
import { BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import { impersonate } from '../../testutil'

import {
  Product,
  Collateral__factory,
  Controller__factory,
  Product__factory,
  Incentivizer__factory,
  IProductProvider__factory,
} from '../../../types/generated'
import { expectPositionEq, expectPrePositionEq } from '../../testutil/types'

const { ethers } = HRE

describe('Product', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let controllerSigner: SignerWithAddress
  let collateralSigner: SignerWithAddress
  let controller: MockContract
  let collateral: MockContract
  let productProvider: MockContract
  let incentivizer: MockContract

  let product: Product

  beforeEach(async () => {
    ;[owner, user, userB, userC] = await ethers.getSigners()
    productProvider = await waffle.deployMockContract(owner, IProductProvider__factory.abi)
    incentivizer = await waffle.deployMockContract(owner, Incentivizer__factory.abi)

    collateral = await waffle.deployMockContract(owner, Collateral__factory.abi)
    collateralSigner = await impersonate.impersonateWithBalance(collateral.address, utils.parseEther('10'))

    controller = await waffle.deployMockContract(owner, Controller__factory.abi)
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))

    product = await new Product__factory(owner).deploy()
    await product.connect(controllerSigner).initialize(productProvider.address)

    await controller.mock['paused(address)'].withArgs(product.address).returns(false)
    await controller.mock.collateral.withArgs().returns(collateral.address)
    await controller.mock.incentivizer.withArgs().returns(incentivizer.address)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await product.controller()).to.equal(controller.address)
      expect(await product.productProvider()).to.equal(productProvider.address)
    })

    it('reverts if already initialized', async () => {
      await expect(product.initialize(productProvider.address)).to.be.revertedWith(
        'UInitializableAlreadyInitializedError(1)',
      )
    })
  })

  describe('long market', async () => {
    const ORACLE_VERSION = 1
    const POSITION = utils.parseEther('10')
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')
    const RATE = utils.parseEther('0.10').div(365 * 24 * 60 * 60)
    const FUNDING_FEE = utils.parseEther('0.10')
    const MAKER_FEE = utils.parseEther('0.0')
    const TAKER_FEE = utils.parseEther('0.0')
    const MAINTENANCE = utils.parseEther('0.5')

    const ORACLE_VERSION_0 = {
      price: 0,
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    const ORACLE_VERSION_2 = {
      price: PRICE,
      timestamp: TIMESTAMP + 3600,
      version: ORACLE_VERSION + 1,
    }

    const ORACLE_VERSION_3 = {
      price: PRICE,
      timestamp: TIMESTAMP + 7200,
      version: ORACLE_VERSION + 2,
    }

    const ORACLE_VERSION_4 = {
      price: PRICE,
      timestamp: TIMESTAMP + 10800,
      version: ORACLE_VERSION + 3,
    }

    beforeEach(async () => {
      await collateral.mock.settleProduct.withArgs(0).returns()
      await collateral.mock.settleAccount.withArgs(user.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userB.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userC.address, 0).returns()
      await collateral.mock.liquidatableNext.withArgs(user.address, product.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userB.address, product.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userC.address, product.address).returns(false)

      await productProvider.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)

      await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await productProvider.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

      await productProvider.mock.rate.withArgs({ maker: 0, taker: 0 }).returns(0)
      await productProvider.mock.fundingFee.withArgs().returns(FUNDING_FEE)
      await productProvider.mock.makerFee.withArgs().returns(MAKER_FEE)
      await productProvider.mock.takerFee.withArgs().returns(TAKER_FEE)
      await productProvider.mock.maintenance.withArgs().returns(MAINTENANCE)
      await productProvider.mock.makerLimit.withArgs().returns(POSITION.mul(10))
      await controller.mock.minFundingFee.withArgs().returns(FUNDING_FEE)

      await incentivizer.mock.sync.withArgs(ORACLE_VERSION_1).returns()

      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()

      await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_1)
    })

    context('#openMake', async () => {
      it('opens the position', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await product.connect(user).openMake(POSITION)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await product.connect(user).openMake(POSITION)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await productProvider.mock.makerFee.withArgs().returns(utils.parseEther('0.01'))

        const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
        await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if oracle not bootstrapped', async () => {
        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_0)
        await productProvider.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_0)

        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductOracleBootstrappingError()')
      })

      it('reverts if can liquidate', async () => {
        await collateral.mock.liquidatableNext.withArgs(user.address, product.address).returns(true)

        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith(
          'ProductInsufficientCollateralError()',
        )
      })

      it('reverts if double sided position', async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)

        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await product.connect(collateralSigner).closeAll(user.address)
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('PausedError()')
      })

      it('reverts if over maker limit', async () => {
        await productProvider.mock.makerLimit.withArgs().returns(POSITION.div(2))
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductMakerOverLimitError()')
      })
    })

    context('#closeMake', async () => {
      beforeEach(async () => {
        await product.connect(user).openMake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(product.connect(user).closeMake(POSITION.div(2)))
          .to.emit(product, 'MakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(product.connect(user).closeMake(POSITION))
          .to.emit(product, 'MakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION.div(2), taker: 0 }).returns(RATE)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(4), { maker: utils.parseEther('1080'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await productProvider.mock.makerFee.withArgs().returns(utils.parseEther('0.01'))

          const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
          await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('reverts if taker > maker', async () => {
          await product.connect(userB).openTake(POSITION)

          await expect(product.connect(user).closeMake(POSITION)).to.be.revertedWith(
            `ProductInsufficientLiquidityError(0)`,
          )
        })

        it('reverts if underflow', async () => {
          await expect(product.connect(user).closeMake(POSITION.mul(2))).to.be.revertedWith('ProductOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await product.connect(collateralSigner).closeAll(user.address)
          await expect(product.connect(user).closeMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await controller.mock['paused(address)'].withArgs(product.address).returns(true)
          await expect(product.connect(user).closeMake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    context('#openTake', async () => {
      beforeEach(async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
      })

      it('opens the position', async () => {
        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await product.connect(user).openTake(POSITION)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await product.connect(user).openTake(POSITION)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await productProvider.mock.takerFee.withArgs().returns(utils.parseEther('0.01'))

        const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleProduct.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
        await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if taker > maker', async () => {
        const socialization = utils.parseEther('0.5')
        await expect(product.connect(user).openTake(POSITION.mul(4))).to.be.revertedWith(
          `ProductInsufficientLiquidityError(${socialization})`,
        )
      })

      it('reverts if double sided position', async () => {
        await product.connect(user).openMake(POSITION)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await product.connect(collateralSigner).closeAll(user.address)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('PausedError()')
      })
    })

    context('#closeTake', async () => {
      beforeEach(async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(product.connect(user).closeTake(POSITION.div(2)))
          .to.emit(product, 'TakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(product.connect(user).closeTake(POSITION))
          .to.emit(product, 'TakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await product.connect(user).closeTake(POSITION.div(2))

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await product.connect(user).closeTake(POSITION.div(2))

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await product.connect(user).closeTake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.25 * 20 * 123 = 7020547944372000
          const EXPECTED_FUNDING_1 = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_2 = ethers.BigNumber.from('7020547944372000')
          const EXPECTED_FUNDING_FEE_1 = EXPECTED_FUNDING_1.div(10)
          const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
          const EXPECTED_FUNDING_WITH_FEE_1 = EXPECTED_FUNDING_1.sub(EXPECTED_FUNDING_FEE_1) // maker funding
          const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE_1).returns()
          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE_2).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_1.mul(-1)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_2.mul(-1)).returns()

          await product.connect(user).closeTake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.div(20),
            taker: EXPECTED_FUNDING_1.div(10).mul(-1),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2).div(20),
            taker: EXPECTED_FUNDING_1.div(10).add(EXPECTED_FUNDING_2.div(5)).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('1080'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await productProvider.mock.takerFee.withArgs().returns(utils.parseEther('0.01'))

          const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('reverts if underflow', async () => {
          await expect(product.connect(user).closeTake(POSITION.mul(2))).to.be.revertedWith('ProductOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await product.connect(collateralSigner).closeAll(user.address)
          await expect(product.connect(user).closeTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await controller.mock['paused(address)'].withArgs(product.address).returns(true)
          await expect(product.connect(user).closeTake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    describe('#closeAll', async () => {
      it('closes maker side', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)

        await product.connect(user).openMake(POSITION)

        await product.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })

        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })
        expect(await product.isLiquidating(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
      })

      it('closes taker side', async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)

        await product.connect(user).openTake(POSITION)

        await product.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })

        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })
        expect(await product.isLiquidating(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
      })

      it('reverts if already initialized', async () => {
        await expect(product.connect(user).closeAll(user.address)).to.be.revertedWith(`NotCollateralError()`)
      })
    })

    context('#settle / #settleAccount', async () => {
      // rate * elapsed * utilization * maker * price
      // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 10 * 123 = 7020547945205480
      const EXPECTED_FUNDING = 7020547944372000
      const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING / 10
      const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING - EXPECTED_FUNDING_FEE // maker funding

      beforeEach(async () => {
        await product.connect(user).openMake(POSITION)
        await product.connect(userB).openTake(POSITION.div(2))

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)
        await product.connect(user).settleAccount(userB.address)
      })

      it('same price same rate settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE / 10,
          taker: (-1 * EXPECTED_FUNDING) / 5,
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price same timestamp settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, -1 * (EXPECTED_FUNDING - EXPECTED_FUNDING_FEE))
          .returns()

        const oracleVersionSameTimestamp = {
          price: PRICE,
          timestamp: TIMESTAMP + 3600,
          version: 3,
        }
        await productProvider.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        await productProvider.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
        await productProvider.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: 0,
          taker: 0,
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: 0,
          taker: 0,
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('lower price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('2').mul(5) // maker pnl

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionLowerPrice = {
          price: utils.parseEther('121'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await productProvider.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        await productProvider.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
        await productProvider.mock.sync.withArgs().returns(oracleVersionLowerPrice)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('605'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('605'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('302.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('higher price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('-2').mul(5) // maker pnl

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionHigherPrice = {
          price: utils.parseEther('125'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await productProvider.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        await productProvider.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
        await productProvider.mock.sync.withArgs().returns(oracleVersionHigherPrice)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('625'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('625'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('312.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price negative rate settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, -1 * EXPECTED_FUNDING).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, EXPECTED_FUNDING_WITH_FEE).returns()

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE.mul(-1))

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: (-1 * EXPECTED_FUNDING) / 10,
          taker: EXPECTED_FUNDING_WITH_FEE / 5,
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      context('socialized', async () => {
        it('with socialization to zero', async () => {
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: 0, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization', async () => {
          await product.connect(userC).openMake(POSITION.div(4))
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
            .returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: POSITION.div(4), taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5,
            taker: -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(product.connect(userC).settleAccount(userC.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await product.isClosed(userC.address)).to.equal(false)
          expect(await product.maintenance(userC.address)).to.equal(utils.parseEther('153.75'))
          expect(await product.maintenanceNext(userC.address)).to.equal(utils.parseEther('153.75'))
          expectPositionEq(await product.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await product['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userC.address)).to.equal(4)
        })

        it('with socialization to zero (price change)', async () => {
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          const oracleVersionHigherPrice = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await productProvider.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await productProvider.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await productProvider.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await productProvider.mock.rate.withArgs({ maker: 0, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('312.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization (price change)', async () => {
          const EXPECTED_POSITION = utils.parseEther('-2').mul(5).div(2) // maker pnl

          await product.connect(userC).openMake(POSITION.div(4))
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount
            .withArgs(userC.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE / 2))
            .returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, EXPECTED_POSITION.add(BigNumber.from(EXPECTED_FUNDING).mul(3).div(2)).mul(-1))
            .returns()

          const oracleVersionHigherPrice = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await productProvider.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await productProvider.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await productProvider.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await productProvider.mock.rate.withArgs({ maker: POSITION.div(4), taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          const MAKER_FUNDING = EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5
          const TAKER_FUNDING = -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10)
          const MAKER_POSITION = EXPECTED_POSITION.mul(2).div(5)
          const TAKER_POSITION = EXPECTED_POSITION.div(-5)
          expectPositionEq(await product.valueAtVersion(4), {
            maker: MAKER_POSITION.add(MAKER_FUNDING),
            taker: TAKER_POSITION.add(TAKER_FUNDING),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('312.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(product.connect(userC).settleAccount(userC.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await product.isClosed(userC.address)).to.equal(false)
          expect(await product.maintenance(userC.address)).to.equal(utils.parseEther('156.25'))
          expect(await product.maintenanceNext(userC.address)).to.equal(utils.parseEther('156.25'))
          expectPositionEq(await product.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await product['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userC.address)).to.equal(4)
        })
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).settle()).to.be.revertedWith('PausedError()')
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).settleAccount(user.address)).to.be.revertedWith('PausedError()')
      })
    })
  })

  describe('short market', async () => {
    const ORACLE_VERSION = 1
    const POSITION = utils.parseEther('10')
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('-123')
    const RATE = utils.parseEther('0.10').div(365 * 24 * 60 * 60)
    const FUNDING_FEE = utils.parseEther('0.10')
    const MAKER_FEE = utils.parseEther('0.0')
    const TAKER_FEE = utils.parseEther('0.0')
    const MAINTENANCE = utils.parseEther('0.5')

    const ORACLE_VERSION_0 = {
      price: 0,
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    const ORACLE_VERSION_2 = {
      price: PRICE,
      timestamp: TIMESTAMP + 3600,
      version: ORACLE_VERSION + 1,
    }

    const ORACLE_VERSION_3 = {
      price: PRICE,
      timestamp: TIMESTAMP + 7200,
      version: ORACLE_VERSION + 2,
    }

    const ORACLE_VERSION_4 = {
      price: PRICE,
      timestamp: TIMESTAMP + 10800,
      version: ORACLE_VERSION + 3,
    }

    beforeEach(async () => {
      await collateral.mock.settleProduct.withArgs(0).returns()
      await collateral.mock.settleAccount.withArgs(user.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userB.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userC.address, 0).returns()
      await collateral.mock.liquidatableNext.withArgs(user.address, product.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userB.address, product.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userC.address, product.address).returns(false)

      await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)

      await productProvider.mock.atVersion.withArgs(0).returns({
        price: BigNumber.from(0),
        timestamp: 0,
        version: 0,
      })

      await productProvider.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

      await productProvider.mock.rate.withArgs({ maker: 0, taker: 0 }).returns(0)
      await productProvider.mock.fundingFee.withArgs().returns(FUNDING_FEE)
      await productProvider.mock.makerFee.withArgs().returns(MAKER_FEE)
      await productProvider.mock.takerFee.withArgs().returns(TAKER_FEE)
      await productProvider.mock.maintenance.withArgs().returns(MAINTENANCE)
      await productProvider.mock.makerLimit.withArgs().returns(POSITION.mul(10))
      await controller.mock.minFundingFee.withArgs().returns(FUNDING_FEE)

      await incentivizer.mock.sync.withArgs(ORACLE_VERSION_1).returns()

      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()

      await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_1)
    })

    context('#openMake', async () => {
      it('opens the position', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await product.connect(user).openMake(POSITION)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await product.connect(user).openMake(POSITION)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await productProvider.mock.makerFee.withArgs().returns(utils.parseEther('0.01'))

        const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
        await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if oracle not bootstrapped', async () => {
        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_0)
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_0)

        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductOracleBootstrappingError()')
      })

      it('reverts if can liquidate', async () => {
        await collateral.mock.liquidatableNext.withArgs(user.address, product.address).returns(true)

        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith(
          'ProductInsufficientCollateralError()',
        )
      })

      it('reverts if double sided position', async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)

        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await product.connect(collateralSigner).closeAll(user.address)
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('PausedError()')
      })

      it('reverts if over maker limit', async () => {
        await productProvider.mock.makerLimit.withArgs().returns(POSITION.div(2))
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductMakerOverLimitError()')
      })
    })

    context('#closeMake', async () => {
      beforeEach(async () => {
        await product.connect(user).openMake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(product.connect(user).closeMake(POSITION.div(2)))
          .to.emit(product, 'MakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(product.connect(user).closeMake(POSITION))
          .to.emit(product, 'MakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          await product.connect(user).closeMake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.rate.withArgs({ maker: POSITION.div(2), taker: 0 }).returns(RATE)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(4), { maker: utils.parseEther('1080'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await productProvider.mock.makerFee.withArgs().returns(utils.parseEther('0.01'))

          const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
          await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: 0 }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('reverts if taker > maker', async () => {
          await product.connect(userB).openTake(POSITION)

          await expect(product.connect(user).closeMake(POSITION)).to.be.revertedWith(
            `ProductInsufficientLiquidityError(0)`,
          )
        })

        it('reverts if underflow', async () => {
          await expect(product.connect(user).closeMake(POSITION.mul(2))).to.be.revertedWith('ProductOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await product.connect(collateralSigner).closeAll(user.address)
          await expect(product.connect(user).closeMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await controller.mock['paused(address)'].withArgs(product.address).returns(true)
          await expect(product.connect(user).closeMake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    context('#openTake', async () => {
      beforeEach(async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
      })

      it('opens the position', async () => {
        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await product.connect(user).openTake(POSITION)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await product.connect(user).openTake(POSITION)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 2)

        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(2)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('1230'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await productProvider.mock.takerFee.withArgs().returns(utils.parseEther('0.01'))

        const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleProduct.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
        await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(2, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if can liquidate', async () => {
        await collateral.mock.liquidatableNext.withArgs(user.address, product.address).returns(true)

        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith(
          'ProductInsufficientCollateralError()',
        )
      })

      it('reverts if taker > maker', async () => {
        const socialization = utils.parseEther('0.5')
        await expect(product.connect(user).openTake(POSITION.mul(4))).to.be.revertedWith(
          `ProductInsufficientLiquidityError(${socialization})`,
        )
      })

      it('reverts if double sided position', async () => {
        await product.connect(user).openMake(POSITION)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await product.connect(collateralSigner).closeAll(user.address)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('PausedError()')
      })
    })

    context('#closeTake', async () => {
      beforeEach(async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(product.connect(user).closeTake(POSITION.div(2)))
          .to.emit(product, 'TakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(product.connect(user).closeTake(POSITION))
          .to.emit(product, 'TakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
        expect(await product.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await product.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await product.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await product['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)
          await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await product.connect(user).closeTake(POSITION.div(2))

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await product['latestVersion()']()).to.equal(2)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await product.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await product.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await product['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await product.connect(user).closeTake(POSITION.div(2))

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await product.connect(user).closeTake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expect(await product['latestVersion()']()).to.equal(3)
          expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.25 * 20 * 123 = 7020547944372000
          const EXPECTED_FUNDING_1 = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_2 = ethers.BigNumber.from('7020547944372000')
          const EXPECTED_FUNDING_FEE_1 = EXPECTED_FUNDING_1.div(10)
          const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
          const EXPECTED_FUNDING_WITH_FEE_1 = EXPECTED_FUNDING_1.sub(EXPECTED_FUNDING_FEE_1) // maker funding
          const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE_1).returns()
          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE_2).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_1.mul(-1)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_2.mul(-1)).returns()

          await product.connect(user).closeTake(POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.div(20),
            taker: EXPECTED_FUNDING_1.div(10).mul(-1),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2).div(20),
            taker: EXPECTED_FUNDING_1.div(10).add(EXPECTED_FUNDING_2.div(5)).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('1080'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await productProvider.mock.takerFee.withArgs().returns(utils.parseEther('0.01'))

          const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleProduct.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('reverts if underflow', async () => {
          await expect(product.connect(user).closeTake(POSITION.mul(2))).to.be.revertedWith('ProductOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await product.connect(collateralSigner).closeAll(user.address)
          await expect(product.connect(user).closeTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await controller.mock['paused(address)'].withArgs(product.address).returns(true)
          await expect(product.connect(user).closeTake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    describe('#closeAll', async () => {
      it('closes maker side', async () => {
        await product.connect(user).openMake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)

        await product.connect(user).openMake(POSITION)

        await product.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })

        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })
        expect(await product.isLiquidating(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
      })

      it('closes taker side', async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION.mul(2), taker: POSITION }).returns(RATE)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)

        await product.connect(user).openTake(POSITION)

        await product.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await product.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })

        expectPositionEq(await product.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })
        expect(await product.isLiquidating(user.address)).to.equal(true)
        expect(await product.maintenance(user.address)).to.equal(0)
      })

      it('reverts if already initialized', async () => {
        await expect(product.connect(user).closeAll(user.address)).to.be.revertedWith(`NotCollateralError()`)
      })
    })

    context('#settle / #settleAccount', async () => {
      // rate * elapsed * utilization * maker * price
      // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 10 * 123 = 7020547945205480
      const EXPECTED_FUNDING = 7020547944372000
      const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING / 10
      const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING - EXPECTED_FUNDING_FEE // maker funding

      beforeEach(async () => {
        await product.connect(user).openMake(POSITION)
        await product.connect(userB).openTake(POSITION.div(2))

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await productProvider.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)
        await product.connect(user).settleAccount(userB.address)
      })

      it('same price same rate settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE / 10,
          taker: (-1 * EXPECTED_FUNDING) / 5,
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price same timestamp settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        const oracleVersionSameTimestamp = {
          price: PRICE,
          timestamp: TIMESTAMP + 3600,
          version: 3,
        }
        await productProvider.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        await productProvider.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
        await productProvider.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: 0,
          taker: 0,
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: 0,
          taker: 0,
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('lower price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('2').mul(5) // maker pnl

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionLowerPrice = {
          price: utils.parseEther('-125'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await productProvider.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        await productProvider.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
        await productProvider.mock.sync.withArgs().returns(oracleVersionLowerPrice)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('625'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('625'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('312.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('higher price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('-2').mul(5) // maker pnl

        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionHigherPrice = {
          price: utils.parseEther('-121'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await productProvider.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        await productProvider.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
        await productProvider.mock.sync.withArgs().returns(oracleVersionHigherPrice)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('605'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('605'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('302.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price negative rate settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, -1 * EXPECTED_FUNDING).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, EXPECTED_FUNDING_WITH_FEE).returns()

        await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE.mul(-1))

        await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

        expect(await product['latestVersion()']()).to.equal(3)
        expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await product.valueAtVersion(3), {
          maker: (-1 * EXPECTED_FUNDING) / 10,
          taker: EXPECTED_FUNDING_WITH_FEE / 5,
        })
        expectPositionEq(await product.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(product.connect(user).settleAccount(user.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product.maintenance(user.address)).to.equal(utils.parseEther('615'))
        expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await product['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](user.address)).to.equal(3)

        await expect(product.connect(userB).settleAccount(userB.address))
          .to.emit(product, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await product.isClosed(userB.address)).to.equal(false)
        expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await product['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await product['latestVersion(address)'](userB.address)).to.equal(3)
      })

      context('socialized', async () => {
        it('with socialization to zero', async () => {
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: 0, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization', async () => {
          await product.connect(userC).openMake(POSITION.div(4))
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
            .returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await productProvider.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await productProvider.mock.rate.withArgs({ maker: POSITION.div(4), taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5,
            taker: -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(product.connect(userC).settleAccount(userC.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await product.isClosed(userC.address)).to.equal(false)
          expect(await product.maintenance(userC.address)).to.equal(utils.parseEther('153.75'))
          expect(await product.maintenanceNext(userC.address)).to.equal(utils.parseEther('153.75'))
          expectPositionEq(await product.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await product['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userC.address)).to.equal(4)
        })

        it('with socialization to zero (price change)', async () => {
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          const oracleVersionHigherPrice = {
            price: utils.parseEther('-121'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await productProvider.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await productProvider.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await productProvider.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await productProvider.mock.rate.withArgs({ maker: 0, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await product.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('302.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization (price change)', async () => {
          const EXPECTED_POSITION = utils.parseEther('-2').mul(5).div(2) // maker pnl

          await product.connect(userC).openMake(POSITION.div(4))
          await product.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()

          await productProvider.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await productProvider.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await productProvider.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await productProvider.mock.rate.withArgs({ maker: POSITION, taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount
            .withArgs(userC.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE / 2))
            .returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, EXPECTED_POSITION.add(BigNumber.from(EXPECTED_FUNDING).mul(3).div(2)).mul(-1))
            .returns()

          const oracleVersionHigherPrice = {
            price: utils.parseEther('-121'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await productProvider.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await productProvider.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await productProvider.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await productProvider.mock.rate.withArgs({ maker: POSITION.div(4), taker: POSITION.div(2) }).returns(RATE)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(4, 4)

          expect(await product['latestVersion()']()).to.equal(4)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await product.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          const MAKER_FUNDING = EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5
          const TAKER_FUNDING = -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10)
          const MAKER_POSITION = EXPECTED_POSITION.mul(2).div(5)
          const TAKER_POSITION = EXPECTED_POSITION.div(-5)
          expectPositionEq(await product.valueAtVersion(4), {
            maker: MAKER_POSITION.add(MAKER_FUNDING),
            taker: TAKER_POSITION.add(TAKER_FUNDING),
          })
          expectPositionEq(await product.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await product.isClosed(user.address)).to.equal(true)
          expect(await product.maintenance(user.address)).to.equal(utils.parseEther('0'))
          expect(await product.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await product.isClosed(userB.address)).to.equal(false)
          expect(await product.maintenance(userB.address)).to.equal(utils.parseEther('302.5'))
          expect(await product.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(product.connect(userC).settleAccount(userC.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await product.isClosed(userC.address)).to.equal(false)
          expect(await product.maintenance(userC.address)).to.equal(utils.parseEther('151.25'))
          expect(await product.maintenanceNext(userC.address)).to.equal(utils.parseEther('151.25'))
          expectPositionEq(await product.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await product['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userC.address)).to.equal(4)
        })
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).settle()).to.be.revertedWith('PausedError()')
      })

      it('reverts if paused', async () => {
        await controller.mock['paused(address)'].withArgs(product.address).returns(true)
        await expect(product.connect(user).settleAccount(user.address)).to.be.revertedWith('PausedError()')
      })
    })
  })
})

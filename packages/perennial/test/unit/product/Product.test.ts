import { smock, MockContract as SmockContract } from '@defi-wonderland/smock'
import { MockContract } from '@ethereum-waffle/mock-contract'
import { BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE, { waffle } from 'hardhat'

import { impersonate } from '../../testutil'

import {
  Product,
  Collateral__factory,
  Controller__factory,
  Product__factory,
  Incentivizer__factory,
  IOracleProvider__factory,
  TestnetPayoffProvider,
  TestnetPayoffProvider__factory,
} from '../../../types/generated'
import { createPayoffDefinition, expectPositionEq, expectPrePositionEq } from '../../testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Product', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let controllerSigner: SignerWithAddress
  let collateralSigner: SignerWithAddress
  let controller: MockContract
  let collateral: MockContract
  let oracle: MockContract
  let incentivizer: MockContract

  let product: Product

  const POSITION = utils.parseEther('10')
  const FUNDING_FEE = utils.parseEther('0.10')
  const MAKER_FEE = utils.parseEther('0.0')
  const TAKER_FEE = utils.parseEther('0.0')
  const MAINTENANCE = utils.parseEther('0.5')
  const PRODUCT_INFO = {
    name: 'Squeeth',
    symbol: 'SQTH',
    payoffDefinition: createPayoffDefinition(),
    oracle: '',
    maintenance: MAINTENANCE,
    fundingFee: FUNDING_FEE,
    makerFee: MAKER_FEE,
    takerFee: TAKER_FEE,
    makerLimit: POSITION.mul(10),
    utilizationCurve: {
      // Force a 0.10 rate to make tests simpler
      minRate: utils.parseEther('0.10'),
      maxRate: utils.parseEther('0.10'),
      targetRate: utils.parseEther('0.10'),
      targetUtilization: utils.parseEther('1'),
    },
  }

  beforeEach(async () => {
    ;[owner, user, userB, userC] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(owner, IOracleProvider__factory.abi)
    incentivizer = await waffle.deployMockContract(owner, Incentivizer__factory.abi)

    collateral = await waffle.deployMockContract(owner, Collateral__factory.abi)
    collateralSigner = await impersonate.impersonateWithBalance(collateral.address, utils.parseEther('10'))

    controller = await waffle.deployMockContract(owner, Controller__factory.abi)
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))

    product = await new Product__factory(owner).deploy()
    PRODUCT_INFO.oracle = oracle.address
    await product.connect(controllerSigner).initialize(PRODUCT_INFO)

    await controller.mock['paused(address)'].withArgs(product.address).returns(false)
    await controller.mock.collateral.withArgs().returns(collateral.address)
    await controller.mock.incentivizer.withArgs().returns(incentivizer.address)
    await controller.mock.coordinatorFor.withArgs(product.address).returns(1)
    await controller.mock.owner.withArgs(1).returns(owner.address)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await product.controller()).to.equal(controller.address)
      expect(await product.name()).to.equal('Squeeth')
      expect(await product.symbol()).to.equal('SQTH')
      const payoffDefinition = await product.payoffDefinition()
      expect(payoffDefinition.payoffType).to.equal(PRODUCT_INFO.payoffDefinition.payoffType)
      expect(payoffDefinition.payoffDirection).to.equal(PRODUCT_INFO.payoffDefinition.payoffDirection)
      expect(payoffDefinition.data).to.equal(PRODUCT_INFO.payoffDefinition.data)
      expect(await product.oracle()).to.equal(oracle.address)
      expect(await product['maintenance()']()).to.equal(utils.parseEther('0.5'))
      expect(await product.fundingFee()).to.equal(utils.parseEther('0.1'))
      expect(await product.makerFee()).to.equal(utils.parseEther('0'))
      expect(await product.takerFee()).to.equal(utils.parseEther('0'))
      expect(await product.makerLimit()).to.equal(utils.parseEther('100'))

      const curve = await product.utilizationCurve()
      expect(curve.minRate).to.equal(utils.parseEther('0.10'))
      expect(curve.maxRate).to.equal(utils.parseEther('0.10'))
      expect(curve.targetRate).to.equal(utils.parseEther('0.10'))
      expect(curve.targetUtilization).to.equal(utils.parseEther('1'))
    })

    it('reverts if already initialized', async () => {
      await expect(product.initialize(PRODUCT_INFO)).to.be.revertedWith('UInitializableAlreadyInitializedError(1)')
    })

    it('reverts if oracle is not a contract', async () => {
      const otherProduct = await new Product__factory(owner).deploy()
      await expect(
        otherProduct.connect(controllerSigner).initialize({ ...PRODUCT_INFO, oracle: user.address }),
      ).to.be.revertedWith('InvalidOracle()')
    })

    describe('payoffDefinition validity', () => {
      let otherProduct: Product

      beforeEach(async () => {
        otherProduct = await new Product__factory(owner).deploy()
      })

      it('reverts if passthrough definition contains data', async () => {
        const payoffDefinition = createPayoffDefinition()
        payoffDefinition.data = payoffDefinition.data.substring(0, payoffDefinition.data.length - 1) + '1'

        await expect(
          otherProduct.connect(controllerSigner).initialize({ ...PRODUCT_INFO, payoffDefinition }),
        ).to.be.revertedWith('InvalidPayoffDefinitionError()')
      })

      it('reverts if product provider is not a contract', async () => {
        await expect(
          otherProduct.connect(controllerSigner).initialize({
            ...PRODUCT_INFO,
            payoffDefinition: createPayoffDefinition({ contractAddress: user.address }),
          }),
        ).to.be.revertedWith('InvalidPayoffDefinitionError()')
      })
    })
  })

  describe('updating params', async () => {
    it('correctly updates the params', async () => {
      await product.updateMaintenance(utils.parseEther('0.1'))
      await product.updateFundingFee(utils.parseEther('0.2'))
      await product.updateMakerFee(utils.parseEther('0.3'))
      await product.updateTakerFee(utils.parseEther('0.4'))
      await product.updateMakerLimit(utils.parseEther('0.5'))
      await product.updateUtilizationCurve({
        minRate: utils.parseEther('0.10'),
        maxRate: utils.parseEther('0.20'),
        targetRate: utils.parseEther('0.30'),
        targetUtilization: utils.parseEther('0.4'),
      })

      expect(await product['maintenance()']()).to.equal(utils.parseEther('0.1'))
      expect(await product.fundingFee()).to.equal(utils.parseEther('0.2'))
      expect(await product.makerFee()).to.equal(utils.parseEther('0.3'))
      expect(await product.takerFee()).to.equal(utils.parseEther('0.4'))
      expect(await product.makerLimit()).to.equal(utils.parseEther('0.5'))

      const curve = await product.utilizationCurve()
      expect(curve.minRate).to.equal(utils.parseEther('0.10'))
      expect(curve.maxRate).to.equal(utils.parseEther('0.20'))
      expect(curve.targetRate).to.equal(utils.parseEther('0.30'))
      expect(curve.targetUtilization).to.equal(utils.parseEther('0.4'))
    })

    it('reverts if not owner', async () => {
      await expect(product.connect(user).updateMaintenance(utils.parseEther('0.1'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(product.connect(user).updateFundingFee(utils.parseEther('0.2'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(product.connect(user).updateMakerFee(utils.parseEther('0.3'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(product.connect(user).updateTakerFee(utils.parseEther('0.4'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(product.connect(user).updateMakerLimit(utils.parseEther('0.5'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
    })

    it('reverts if fees are too high', async () => {
      await expect(product.updateFundingFee(utils.parseEther('1.01'))).to.be.be.revertedWith(
        'ProductInvalidFundingFee()',
      )
      await expect(product.updateMakerFee(utils.parseEther('1.01'))).to.be.be.revertedWith('ProductInvalidMakerFee()')
      await expect(product.updateTakerFee(utils.parseEther('1.01'))).to.be.be.revertedWith('ProductInvalidTakerFee()')
    })
  })

  describe('positive price market', async () => {
    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

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

      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

      await controller.mock.minFundingFee.withArgs().returns(FUNDING_FEE)

      await incentivizer.mock.sync.withArgs(ORACLE_VERSION_1).returns()

      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
    })

    context('#openMake', async () => {
      it('opens the position', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        await product.updateMakerFee(utils.parseEther('0.01'))

        const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
        await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if oracle not bootstrapped', async () => {
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_0)
        await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_0)

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
        await product.updateMakerLimit(POSITION.div(2))
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductMakerOverLimitError()')
      })

      it('reverts if closed', async () => {
        await product.updateClosed(true)
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductClosedError()')
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await product.updateMakerFee(utils.parseEther('0.01'))

          const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
          await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position if taker > maker and product is closed', async () => {
          await product.connect(userB).openTake(POSITION)
          await product.updateClosed(true)

          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        await product.updateTakerFee(utils.parseEther('0.01'))

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

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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

      it('reverts if closed', async () => {
        await product.updateClosed(true)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductClosedError()')
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await product.updateTakerFee(utils.parseEther('0.01'))

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

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
      })

      it('closes taker side', async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)
        await product.connect(user).settleAccount(userB.address)
      })

      it('same price same rate settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionLowerPrice)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('605'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
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
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('625'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await product.updateUtilizationCurve({
          minRate: utils.parseEther('0.10').mul(-1),
          maxRate: utils.parseEther('0.10').mul(-1),
          targetRate: utils.parseEther('0.10').mul(-1),
          targetUtilization: utils.parseEther('1'),
        })

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
            .returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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
          expect(await product['maintenance(address)'](userC.address)).to.equal(utils.parseEther('153.75'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          const oracleVersionHigherPrice = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
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
          expect(await product['maintenance(address)'](userC.address)).to.equal(utils.parseEther('156.25'))
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

      context('closed product', async () => {
        it('zeroes PnL and fees (price change)', async () => {
          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(owner).updateClosed(true))
            .to.emit(product, 'ClosedUpdated')
            .withArgs(true, 3)
            .to.emit(product, 'Settle')
            .withArgs(3, 3)
          expect(await product.closed()).to.be.true

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)
          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 3, 3)

          const oracleVersionHigherPrice_0 = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          const oracleVersionHigherPrice_1 = {
            price: utils.parseEther('128'),
            timestamp: TIMESTAMP + 10800,
            version: 5,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_0)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice_0)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_0).returns()

          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_1)
          await oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice_1)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_1).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice_1)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(5, 5)

          expect(await product['latestVersion()']()).to.equal(5)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(5), { maker: POSITION, taker: POSITION.div(2) })
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
          expectPositionEq(await product.valueAtVersion(5), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(5), {
            maker: utils.parseEther('0.1').mul(7200),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 5, 5)

          expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(5)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 5, 5)

          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(5)
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

  describe('negative price market', async () => {
    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('-123')

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

      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

      await controller.mock.minFundingFee.withArgs().returns(FUNDING_FEE)

      await incentivizer.mock.sync.withArgs(ORACLE_VERSION_1).returns()

      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
    })

    context('#openMake', async () => {
      it('opens the position', async () => {
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        await product.updateMakerFee(utils.parseEther('0.01'))

        const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
        await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(product.connect(user).openMake(POSITION))
          .to.emit(product, 'MakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if oracle not bootstrapped', async () => {
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_0)
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_0)

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
        await product.updateMakerLimit(POSITION.div(2))
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductMakerOverLimitError()')
      })

      it('reverts if closed', async () => {
        await product.updateClosed(true)
        await expect(product.connect(user).openMake(POSITION)).to.be.revertedWith('ProductClosedError()')
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        expect(await product.isClosed(user.address)).to.be.true
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeMake(POSITION.div(2)))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await product.updateMakerFee(utils.parseEther('0.01'))

          const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
          await collateral.mock.settleProduct.withArgs(MAKER_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
          expect(await product.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await product.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position if taker > maker and product is closed', async () => {
          await product.connect(userB).openTake(POSITION)
          await product.updateClosed(true)

          await expect(product.connect(user).closeMake(POSITION))
            .to.emit(product, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await product.isClosed(user.address)).to.equal(false)
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(product.connect(user).openTake(POSITION))
          .to.emit(product, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
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

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        await product.updateTakerFee(utils.parseEther('0.01'))

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

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await product.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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

      it('reverts if closed', async () => {
        await product.updateClosed(true)
        await expect(product.connect(user).openTake(POSITION)).to.be.revertedWith('ProductClosedError()')
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await product.connect(user).settle()
          await product.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(product.connect(user).closeTake(POSITION))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await product.isClosed(user.address)).to.equal(false)
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).closeTake(POSITION.div(2)))
            .to.emit(product, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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
          await product.updateTakerFee(utils.parseEther('0.01'))

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

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
      })

      it('closes taker side', async () => {
        await product.connect(userB).openMake(POSITION.mul(2))
        await product.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(0)
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await product.connect(user).settle()
        await product.connect(user).settleAccount(user.address)
        await product.connect(user).settleAccount(userB.address)
      })

      it('same price same rate settle', async () => {
        await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionLowerPrice)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('625'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
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
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('605'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
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

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await product.updateUtilizationCurve({
          minRate: utils.parseEther('0.10').mul(-1),
          maxRate: utils.parseEther('0.10').mul(-1),
          targetRate: utils.parseEther('0.10').mul(-1),
          targetUtilization: utils.parseEther('1'),
        })

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
        expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
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
        expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
            .returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
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
          expect(await product['maintenance(address)'](userC.address)).to.equal(utils.parseEther('153.75'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(3, 3)

          const oracleVersionHigherPrice = {
            price: utils.parseEther('-121'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
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

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

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
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

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
          expect(await product['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
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
          expect(await product['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
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
          expect(await product['maintenance(address)'](userC.address)).to.equal(utils.parseEther('151.25'))
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

      context('closed product', async () => {
        it('zeroes PnL and fees (price change)', async () => {
          await collateral.mock.settleProduct.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(product.connect(owner).updateClosed(true))
            .to.emit(product, 'ClosedUpdated')
            .withArgs(true, 3)
            .to.emit(product, 'Settle')
            .withArgs(3, 3)

          expect(await product.closed()).to.equal(true)
          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 3, 3)
          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 3, 3)

          const oracleVersionHigherPrice_0 = {
            price: utils.parseEther('-125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          const oracleVersionHigherPrice_1 = {
            price: utils.parseEther('-128'),
            timestamp: TIMESTAMP + 10800,
            version: 5,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_0)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice_0)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_0).returns()

          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_1)
          await oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice_1)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_1).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice_1)

          await expect(product.connect(user).settle()).to.emit(product, 'Settle').withArgs(5, 5)

          expect(await product['latestVersion()']()).to.equal(5)
          expectPositionEq(await product.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
          expectPositionEq(await product.positionAtVersion(5), { maker: POSITION, taker: POSITION.div(2) })
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
          expectPositionEq(await product.valueAtVersion(5), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await product.shareAtVersion(5), {
            maker: utils.parseEther('0.1').mul(7200),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(product.connect(user).settleAccount(user.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(user.address, 5, 5)

          expectPositionEq(await product.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await product['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](user.address)).to.equal(5)

          await expect(product.connect(userB).settleAccount(userB.address))
            .to.emit(product, 'AccountSettle')
            .withArgs(userB.address, 5, 5)

          expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await product['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await product['latestVersion(address)'](userB.address)).to.equal(5)
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

  describe('#rate', async () => {
    const SECONDS_IN_YEAR = 60 * 60 * 24 * 365
    beforeEach(async () => {
      await product.updateUtilizationCurve({
        minRate: 0,
        maxRate: utils.parseEther('5.00'),
        targetRate: utils.parseEther('0.80'),
        targetUtilization: utils.parseEther('0.80'),
      })
    })

    it('handles zero maker', async () => {
      expect(await product.rate({ maker: 0, taker: 0 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 0, taker: 100 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    })

    it('returns the proper rate from utilization', async () => {
      expect(await product.rate({ maker: 100, taker: 0 })).to.equal(utils.parseEther('0.00').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 100, taker: 25 })).to.equal(utils.parseEther('0.25').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 100, taker: 50 })).to.equal(utils.parseEther('0.50').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 100, taker: 75 })).to.equal(utils.parseEther('0.75').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 100, taker: 90 })).to.equal(utils.parseEther('2.90').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 100, taker: 100 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
      expect(await product.rate({ maker: 100, taker: 125 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    })
  })

  describe('contract long payoff definition', async () => {
    let contractPayoffDefinition: SmockContract<TestnetPayoffProvider>
    let otherProduct: Product

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      const payoffDefinitionFactory = await smock.mock<TestnetPayoffProvider__factory>('TestnetPayoffProvider')
      contractPayoffDefinition = await payoffDefinitionFactory.deploy()

      otherProduct = await new Product__factory(owner).deploy()
      PRODUCT_INFO.payoffDefinition = createPayoffDefinition({ contractAddress: contractPayoffDefinition.address })
      await otherProduct.connect(controllerSigner).initialize(PRODUCT_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('15129'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('4'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })
  })

  describe('contract short payoff definition', async () => {
    let contractPayoffDefinition: SmockContract<TestnetPayoffProvider>
    let otherProduct: Product

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      const payoffDefinitionFactory = await smock.mock<TestnetPayoffProvider__factory>('TestnetPayoffProvider')
      contractPayoffDefinition = await payoffDefinitionFactory.deploy()

      otherProduct = await new Product__factory(owner).deploy()
      PRODUCT_INFO.payoffDefinition = createPayoffDefinition({
        short: true,
        contractAddress: contractPayoffDefinition.address,
      })
      await otherProduct.connect(controllerSigner).initialize(PRODUCT_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('-15129'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('-4'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })
  })

  describe('passthrough long payoff definition', async () => {
    let otherProduct: Product

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      otherProduct = await new Product__factory(owner).deploy()
      PRODUCT_INFO.payoffDefinition = createPayoffDefinition()
      await otherProduct.connect(controllerSigner).initialize(PRODUCT_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('123'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('2'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
      })
    })
  })

  describe('passthrough short payoff definition', async () => {
    let otherProduct: Product

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      otherProduct = await new Product__factory(owner).deploy()
      PRODUCT_INFO.payoffDefinition = createPayoffDefinition({ short: true })
      await otherProduct.connect(controllerSigner).initialize(PRODUCT_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('-123'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherProduct.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('-2'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
      })
    })
  })
})

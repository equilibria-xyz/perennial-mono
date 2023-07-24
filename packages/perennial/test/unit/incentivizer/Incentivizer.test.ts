import { MockContract, deployMockContract } from '@ethereum-waffle/mock-contract'
import { BigNumber, BigNumberish, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { impersonate } from '../../../../common/testutil'

import {
  Incentivizer,
  Collateral__factory,
  Controller__factory,
  Product__factory,
  Incentivizer__factory,
  IERC20Metadata__factory,
} from '../../../types/generated'
import { currentBlockTimestamp, increase } from '../../../../common/testutil/time'
import { expectProgramInfoEq, ProgramInfo } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const { ethers } = HRE

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY
const PRODUCT_COORDINATOR_ID = 1

describe('Incentivizer', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let treasury: SignerWithAddress
  let productOwner: SignerWithAddress
  let productTreasury: SignerWithAddress
  let productOwnerB: SignerWithAddress
  let productTreasuryB: SignerWithAddress
  let controllerSigner: SignerWithAddress
  let productSigner: SignerWithAddress
  let productSignerB: SignerWithAddress
  let multiInvokerMock: SignerWithAddress
  let controller: MockContract
  let collateral: MockContract
  let token: MockContract
  let product: MockContract
  let productB: MockContract

  let incentivizer: Incentivizer

  const incentivizerFixture = async () => {
    ;[user, owner, treasury, productOwner, productTreasury, productOwnerB, productTreasuryB, multiInvokerMock] =
      await ethers.getSigners()
    product = await deployMockContract(owner, Product__factory.abi)
    productB = await deployMockContract(owner, Product__factory.abi)
    productSigner = await impersonate.impersonateWithBalance(product.address, utils.parseEther('10'))
    productSignerB = await impersonate.impersonateWithBalance(productB.address, utils.parseEther('10'))

    token = await deployMockContract(owner, IERC20Metadata__factory.abi)
    await token.mock.decimals.withArgs().returns(18)

    collateral = await deployMockContract(owner, Collateral__factory.abi)

    controller = await deployMockContract(owner, Controller__factory.abi)
    controllerSigner = await impersonate.impersonateWithBalance(controller.address, utils.parseEther('10'))

    incentivizer = await new Incentivizer__factory(owner).deploy()
    await incentivizer.connect(controllerSigner).initialize(controller.address)

    await controller.mock.collateral.withArgs().returns(collateral.address)
    await controller.mock.incentivizer.withArgs().returns(incentivizer.address)
    await controller.mock.isProduct.withArgs(product.address).returns(true)
    await controller.mock.isProduct.withArgs(productB.address).returns(true)
    await controller.mock['treasury()'].withArgs().returns(treasury.address)
    await controller.mock['owner(uint256)'].withArgs(0).returns(owner.address)
    await controller.mock['treasury(uint256)'].withArgs(0).returns(treasury.address)
    await controller.mock['owner(uint256)'].withArgs(PRODUCT_COORDINATOR_ID).returns(productOwner.address)
    await controller.mock['treasury(uint256)'].withArgs(PRODUCT_COORDINATOR_ID).returns(productTreasury.address)
    await controller.mock['owner(uint256)'].withArgs(2).returns(productOwnerB.address)
    await controller.mock['treasury(uint256)'].withArgs(2).returns(productTreasuryB.address)
    await controller.mock.paused.withArgs().withArgs().returns(false)
    await controller.mock.coordinatorFor.withArgs(product.address).returns(PRODUCT_COORDINATOR_ID)
    await controller.mock.coordinatorFor.withArgs(productB.address).returns(2)
    await controller.mock.incentivizationFee.withArgs().returns(0)
    await controller.mock.programsPerProduct.withArgs().returns(2)
    await controller.mock.multiInvoker.withArgs().returns(multiInvokerMock.address)
  }

  beforeEach(async () => {
    await loadFixture(incentivizerFixture)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await incentivizer.controller()).to.equal(controller.address)
    })

    it('reverts if already initialized', async () => {
      await expect(incentivizer.connect(owner).initialize(controller.address))
        .to.be.revertedWithCustomError(incentivizer, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })

    it('reverts if controller is zero address', async () => {
      const incentivizerFresh = await new Incentivizer__factory(owner).deploy()
      await expect(incentivizerFresh.initialize(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
        incentivizerFresh,
        'InvalidControllerError',
      )
    })
  })

  describe('#create', async () => {
    it('product owner can create program', async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const EXPECTED_PROGRAM_ID = 0
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: BigNumber.from(PRODUCT_COORDINATOR_ID),
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: BigNumber.from(NOW + HOUR),
        duration: BigNumber.from(30 * DAY),
      }

      const returnValue = await incentivizer.connect(productOwner).callStatic.create(product.address, PROGRAM_INFO)
      await expect(incentivizer.connect(productOwner).create(product.address, PROGRAM_INFO))
        .to.emit(incentivizer, 'ProgramCreated')
        .withArgs(product.address, 0, PROGRAM_INFO, 0)

      expect(returnValue).to.equal(EXPECTED_PROGRAM_ID)
      expectProgramInfoEq(await incentivizer.programInfos(product.address, EXPECTED_PROGRAM_ID), PROGRAM_INFO)

      expect(await incentivizer.count(product.address)).to.equal(1)
      expect(await incentivizer.active(product.address)).to.equal(1)
      expect(await incentivizer.available(product.address, EXPECTED_PROGRAM_ID)).to.equal(utils.parseEther('10000'))
      expect(await incentivizer.versionStarted(product.address, EXPECTED_PROGRAM_ID)).to.equal(0)
      expect(await incentivizer.versionComplete(product.address, EXPECTED_PROGRAM_ID)).to.equal(0)

      expect(await incentivizer.owner(product.address, EXPECTED_PROGRAM_ID)).to.equal(productOwner.address)
      expect(await incentivizer['treasury(address,uint256)'](product.address, EXPECTED_PROGRAM_ID)).to.equal(
        productTreasury.address,
      )
      expect(await incentivizer['treasury(uint256)'](PRODUCT_COORDINATOR_ID)).to.equal(productTreasury.address)
    })

    it('protocol owner can create program', async () => {
      await token.mock.transferFrom
        .withArgs(owner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const EXPECTED_PROGRAM_ID = 0
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: BigNumber.from(0),
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: BigNumber.from(NOW + HOUR),
        duration: BigNumber.from(30 * DAY),
      }

      const returnValue = await incentivizer.connect(owner).callStatic.create(product.address, PROGRAM_INFO)
      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO))
        .to.emit(incentivizer, 'ProgramCreated')
        .withArgs(product.address, 0, PROGRAM_INFO, 0)

      expect(returnValue).to.equal(EXPECTED_PROGRAM_ID)
      expectProgramInfoEq(await incentivizer.programInfos(product.address, EXPECTED_PROGRAM_ID), PROGRAM_INFO)

      expect(await incentivizer.count(product.address)).to.equal(1)
      expect(await incentivizer.active(product.address)).to.equal(1)
      expect(await incentivizer.available(product.address, EXPECTED_PROGRAM_ID)).to.equal(utils.parseEther('10000'))
      expect(await incentivizer.versionStarted(product.address, EXPECTED_PROGRAM_ID)).to.equal(0)
      expect(await incentivizer.versionComplete(product.address, EXPECTED_PROGRAM_ID)).to.equal(0)

      expect(await incentivizer.owner(product.address, EXPECTED_PROGRAM_ID)).to.equal(owner.address)
      expect(await incentivizer['treasury(address,uint256)'](product.address, EXPECTED_PROGRAM_ID)).to.equal(
        treasury.address,
      )
      expect(await incentivizer['treasury(uint256)'](PRODUCT_COORDINATOR_ID)).to.equal(productTreasury.address)
    })

    it('can create program with fee', async () => {
      await token.mock.transferFrom
        .withArgs(owner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      await controller.mock.incentivizationFee.withArgs().returns(utils.parseEther('0.01'))

      const EXPECTED_PROGRAM_ID = 0
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      const PROGRAM_INFO_WITH_FEE: ProgramInfo = {
        coordinatorId: BigNumber.from(0),
        token: token.address,
        amount: {
          maker: utils.parseEther('7920'),
          taker: utils.parseEther('1980'),
        },
        start: BigNumber.from(NOW + HOUR),
        duration: BigNumber.from(30 * DAY),
      }

      const returnValue = await incentivizer.connect(owner).callStatic.create(product.address, PROGRAM_INFO)
      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO))
        .to.emit(incentivizer, 'ProgramCreated')
        .withArgs(product.address, 0, PROGRAM_INFO_WITH_FEE, utils.parseEther('100'))

      expect(returnValue).to.equal(EXPECTED_PROGRAM_ID)
      expectProgramInfoEq(await incentivizer.programInfos(product.address, EXPECTED_PROGRAM_ID), PROGRAM_INFO_WITH_FEE)

      expect(await incentivizer.count(product.address)).to.equal(1)
      expect(await incentivizer.active(product.address)).to.equal(1)
      expect(await incentivizer.available(product.address, EXPECTED_PROGRAM_ID)).to.equal(utils.parseEther('9900'))
      expect(await incentivizer.versionStarted(product.address, EXPECTED_PROGRAM_ID)).to.equal(0)
      expect(await incentivizer.versionComplete(product.address, EXPECTED_PROGRAM_ID)).to.equal(0)

      expect(await incentivizer.owner(product.address, EXPECTED_PROGRAM_ID)).to.equal(owner.address)
      expect(await incentivizer['treasury(address,uint256)'](product.address, EXPECTED_PROGRAM_ID)).to.equal(
        treasury.address,
      )
      expect(await incentivizer['treasury(uint256)'](PRODUCT_COORDINATOR_ID)).to.equal(productTreasury.address)

      expect(await incentivizer.fees(token.address)).to.equal(utils.parseEther('100'))
    })

    it('reverts if not product', async () => {
      await controller.mock.isProduct.withArgs(product.address).returns(false)

      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO))
        .to.be.revertedWithCustomError(incentivizer, `NotProductError`)
        .withArgs(product.address)
    })

    it('reverts if too many programs', async () => {
      await token.mock.transferFrom
        .withArgs(owner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      await incentivizer.connect(owner).create(product.address, PROGRAM_INFO)
      await incentivizer.connect(owner).create(product.address, PROGRAM_INFO)

      expect(await incentivizer.count(product.address)).to.equal(2)
      expect(await incentivizer.active(product.address)).to.equal(2)

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO)).to.be.revertedWithCustomError(
        incentivizer,
        `IncentivizerTooManyProgramsError`,
      )
    })

    it('reverts if not owner', async () => {
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      await expect(incentivizer.connect(user).create(product.address, PROGRAM_INFO))
        .to.be.revertedWithCustomError(incentivizer, `NotOwnerError`)
        .withArgs(0)
    })

    it('reverts if not product owner', async () => {
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO))
        .to.be.revertedWithCustomError(incentivizer, `NotOwnerError`)
        .withArgs(1)
    })

    it('reverts if not coordinator', async () => {
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 2,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      await expect(incentivizer.connect(productOwnerB).create(product.address, PROGRAM_INFO))
        .to.be.revertedWithCustomError(incentivizer, `IncentivizerNotAllowedError`)
        .withArgs(product.address)
    })

    it('reverts if already started', async () => {
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW - HOUR,
        duration: 30 * DAY,
      }

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO)).to.be.revertedWithCustomError(
        incentivizer,
        `ProgramInvalidStartError`,
      )
    })

    it('reverts if too short duration', async () => {
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 12 * HOUR,
      }

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO)).to.be.revertedWithCustomError(
        incentivizer,
        `ProgramInvalidDurationError`,
      )
    })

    it('reverts if too long duration', async () => {
      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 4 * YEAR,
      }

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO)).to.be.revertedWithCustomError(
        incentivizer,
        `ProgramInvalidDurationError`,
      )
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.withArgs().returns(true)

      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO: ProgramInfo = {
        coordinatorId: 0,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      await expect(incentivizer.connect(owner).create(product.address, PROGRAM_INFO)).to.be.revertedWithCustomError(
        incentivizer,
        `PausedError`,
      )
    })
  })

  describe('#sync', async () => {
    const fixture = async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const NOW = await currentBlockTimestamp()

      const PROGRAM_INFO_1: ProgramInfo = {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      }

      const PROGRAM_INFO_2: ProgramInfo = {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: NOW + 4 * HOUR,
        duration: 60 * DAY,
      }

      await incentivizer.connect(productOwner).create(product.address, PROGRAM_INFO_1)
      await incentivizer.connect(productOwner).create(product.address, PROGRAM_INFO_2)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('correctly starts neither program', async () => {
      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 12

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        }),
      )

      expect(await incentivizer.count(product.address)).to.equal(2)
      expect(await incentivizer.active(product.address)).to.equal(2)
      expect(await incentivizer.versionStarted(product.address, 0)).to.equal(0)
      expect(await incentivizer.versionComplete(product.address, 0)).to.equal(0)
      expect(await incentivizer.versionStarted(product.address, 1)).to.equal(0)
      expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
    })

    it('correctly starts first program', async () => {
      await increase(2 * HOUR)

      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 13

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        }),
      )
        .to.emit(incentivizer, 'ProgramStarted')
        .withArgs(product.address, 0, LATEST_VERSION + 1)

      expect(await incentivizer.count(product.address)).to.equal(2)
      expect(await incentivizer.active(product.address)).to.equal(2)
      expect(await incentivizer.versionStarted(product.address, 0)).to.equal(LATEST_VERSION + 1)
      expect(await incentivizer.versionComplete(product.address, 0)).to.equal(0)
      expect(await incentivizer.versionStarted(product.address, 1)).to.equal(0)
      expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
    })

    it('correctly starts both programs', async () => {
      await increase(12 * HOUR)

      const now = await currentBlockTimestamp()
      const LATEST_VERSION = 15

      await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

      await expect(
        incentivizer.connect(productSigner).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: LATEST_VERSION + 1,
        }),
      )
        .to.emit(incentivizer, 'ProgramStarted')
        .withArgs(product.address, 0, LATEST_VERSION + 1)
        .to.emit(incentivizer, 'ProgramStarted')
        .withArgs(product.address, 1, LATEST_VERSION + 1)

      expect(await incentivizer.count(product.address)).to.equal(2)
      expect(await incentivizer.active(product.address)).to.equal(2)
      expect(await incentivizer.versionStarted(product.address, 0)).to.equal(LATEST_VERSION + 1)
      expect(await incentivizer.versionComplete(product.address, 0)).to.equal(0)
      expect(await incentivizer.versionStarted(product.address, 1)).to.equal(LATEST_VERSION + 1)
      expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
    })

    context('no start', async () => {
      it('correctly completes neither program', async () => {
        await increase(29 * DAY)

        const now = await currentBlockTimestamp()
        const LATEST_VERSION = 19

        await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

        await expect(
          incentivizer.connect(productSigner).sync({
            price: utils.parseEther('1'),
            timestamp: now,
            version: LATEST_VERSION + 1,
          }),
        )
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 0, LATEST_VERSION + 1)
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 1, LATEST_VERSION + 1)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(2)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(LATEST_VERSION + 1)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(LATEST_VERSION + 1)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
      })

      it('correctly completes first program', async () => {
        await increase(31 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        await product.mock.atVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns(CURRENT_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 1, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(1)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          utils.parseEther('10000'),
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
      })

      it('correctly completes first program later', async () => {
        await increase(31 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 10,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        await product.mock.atVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns(CURRENT_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 1, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(1)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          utils.parseEther('10000'),
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
      })

      it('correctly completes both programs', async () => {
        await increase(61 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 32 * DAY,
          version: 46,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        await product.mock.atVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns(CURRENT_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 1, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 1, CURRENT_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          utils.parseEther('10000'),
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 1)).to.equal(
          utils.parseEther('20000'),
        )
      })

      it('doesnt recomplete program', async () => {
        await increase(31 * DAY)

        let NOW = await currentBlockTimestamp()
        const PRE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const STARTED_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: PRE_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(PRE_ORACLE_VERSION.version)

        await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)

        await incentivizer.connect(productSigner).sync(STARTED_ORACLE_VERSION)

        await increase(30 * DAY)

        NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 46,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        const EXPECTED_REFUND_AMOUNT = utils
          .parseEther('20000')
          .mul(60 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(60 * DAY)

        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 1, LATEST_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          utils.parseEther('10000'),
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 1)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )
      })
    })

    context('start first', async () => {
      let STARTED_ORACLE_VERSION: {
        price: BigNumberish
        timestamp: number
        version: number
      }

      const fixture = async () => {
        await increase(12 * HOUR)

        const NOW = await currentBlockTimestamp()
        STARTED_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: 15,
        }

        await product.mock.latestVersion.withArgs().returns(STARTED_ORACLE_VERSION.version)

        await incentivizer.connect(productSigner).sync(STARTED_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('correctly completes neither program', async () => {
        await increase(29 * DAY)

        const now = await currentBlockTimestamp()
        const LATEST_VERSION = 19

        await product.mock.latestVersion.withArgs().returns(LATEST_VERSION)

        await expect(
          incentivizer.connect(productSigner).sync({
            price: utils.parseEther('1'),
            timestamp: now,
            version: LATEST_VERSION + 1,
          }),
        )

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(2)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
      })

      it('correctly completes first program', async () => {
        await increase(31 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        const EXPECTED_REFUND_AMOUNT = utils
          .parseEther('10000')
          .mul(30 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(30 * DAY)

        await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, LATEST_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(1)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
      })

      it('correctly completes first program later', async () => {
        await increase(31 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 10,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        const EXPECTED_REFUND_AMOUNT = utils
          .parseEther('10000')
          .mul(30 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(30 * DAY)

        await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, LATEST_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(1)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(0)
      })

      it('correctly completes both programs', async () => {
        await increase(61 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 32 * DAY,
          version: 46,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        const EXPECTED_REFUND_AMOUNT = utils
          .parseEther('10000')
          .mul(30 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(30 * DAY)
        const EXPECTED_REFUND_AMOUNT_2 = utils
          .parseEther('20000')
          .mul(60 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(60 * DAY)

        await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, LATEST_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 1, LATEST_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 1)).to.equal(
          EXPECTED_REFUND_AMOUNT_2,
        )
      })

      it('doesnt recomplete program', async () => {
        await increase(31 * DAY)

        let NOW = await currentBlockTimestamp()
        let LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        let CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        let EXPECTED_REFUND_AMOUNT = utils
          .parseEther('10000')
          .mul(30 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(30 * DAY)

        await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )

        await increase(30 * DAY)

        NOW = await currentBlockTimestamp()
        LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 46,
        }

        CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 1,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

        EXPECTED_REFUND_AMOUNT = utils
          .parseEther('20000')
          .mul(60 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(60 * DAY)

        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await expect(incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION))
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 1, LATEST_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(2)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(23)
        expect(await incentivizer.versionStarted(product.address, 1)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 1)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 1)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )
      })
    })

    it('reverts if not product', async () => {
      const now = await currentBlockTimestamp()
      await controller.mock.isProduct.withArgs(user.address).returns(false)

      await expect(
        incentivizer.connect(user).sync({
          price: utils.parseEther('1'),
          timestamp: now,
          version: 23 + 1,
        }),
      )
        .to.be.revertedWithCustomError(incentivizer, `NotProductError`)
        .withArgs(user.address)
    })
  })

  describe('#syncAccount', async () => {
    const fixture = async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
      })

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
      })
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    context('before start', async () => {
      it('settles correct amount (maker position)', async () => {
        const NOW = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 0
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: 23,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(0).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        expect(await incentivizer.available(product.address, 0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)

        expect(await incentivizer.available(product.address, 1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
      })

      it('settles correct amount (taker position)', async () => {
        const NOW = await currentBlockTimestamp()
        const LATEST_USER_VERSION = 0
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: 23,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('20'),
        })
        await product.mock.shareAtVersion.withArgs(0).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        expect(await incentivizer.available(product.address, 0)).to.equal(utils.parseEther('10000'))
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)

        expect(await incentivizer.available(product.address, 1)).to.equal(utils.parseEther('20000'))
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
      })
    })

    context('over start', async () => {
      let START_ORACLE_VERSION: {
        version: BigNumberish
        timestamp: BigNumberish
        price: BigNumberish
      }

      const fixture = async () => {
        await increase(2 * HOUR)
        START_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 17,
        }
        await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('settles correct amount (maker position)', async () => {
        const LATEST_USER_VERSION = 0
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 23,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(START_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555554200')
        // 16000 * 10^18 / (60 * 60 * 24 * 60) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555554200')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })

      it('settles correct amount (taker position)', async () => {
        const LATEST_USER_VERSION = 0
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 23,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('20'),
        })
        await product.mock.shareAtVersion.withArgs(START_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555548800')
        // 4000 * 10^18 / (60 * 60 * 24 * 60) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555548800')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })
    })

    context('running', async () => {
      let START_ORACLE_VERSION: {
        version: BigNumberish
        timestamp: BigNumberish
        price: BigNumberish
      }

      const fixture = async () => {
        await increase(2 * HOUR)
        START_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 17,
        }
        await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('settles correct amount (maker position)', async () => {
        const LATEST_USER_VERSION = 20
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 23,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555554200')
        // 16000 * 10^18 / (60 * 60 * 24 * 60) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555554200')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })

      it('settles correct amount (taker position)', async () => {
        const LATEST_USER_VERSION = 20
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 23,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('20'),
        })
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555548800')
        // 4000 * 10^18 / (60 * 60 * 24 * 60) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555548800')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })
    })

    context('over complete', async () => {
      let START_ORACLE_VERSION: {
        version: number
        timestamp: number
        price: BigNumberish
      }

      let COMPLETE_ORACLE_VERSION: {
        version: number
        timestamp: number
        price: BigNumberish
      }

      let REFUND_AMOUNT_0: BigNumberish
      let REFUND_AMOUNT_1: BigNumberish

      const fixture = async () => {
        await increase(2 * HOUR)
        START_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 17,
        }
        await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)

        await increase(60 * DAY)
        COMPLETE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: (await currentBlockTimestamp()) - 31 * DAY,
          version: 66,
        }

        REFUND_AMOUNT_0 = utils
          .parseEther('10000')
          .mul(30 * DAY - (COMPLETE_ORACLE_VERSION.timestamp - START_ORACLE_VERSION.timestamp))
          .div(30 * DAY)
        REFUND_AMOUNT_1 = utils
          .parseEther('20000')
          .mul(60 * DAY - (COMPLETE_ORACLE_VERSION.timestamp - START_ORACLE_VERSION.timestamp))
          .div(60 * DAY)
        await product.mock['latestVersion()'].withArgs().returns(COMPLETE_ORACLE_VERSION.version)
        await product.mock.atVersion.withArgs(START_ORACLE_VERSION.version).returns(START_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns(COMPLETE_ORACLE_VERSION)
        const POST_COMPLETE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 68,
        }
        await incentivizer.connect(productSigner).sync(POST_COMPLETE_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('settles correct amount (maker position)', async () => {
        const LATEST_USER_VERSION = 60
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 70,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555554200')
        // 16000 * 10^18 / (60 * 60 * 24 * 60) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555554200')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0).sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1).sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })

      it('settles correct amount (taker position)', async () => {
        const LATEST_USER_VERSION = 60
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 70,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('20'),
        })
        await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555548800')
        // 4000 * 10^18 / (60 * 60 * 24 * 60) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555548800')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0).sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1).sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })
    })

    context('complete', async () => {
      let START_ORACLE_VERSION: {
        version: number
        timestamp: number
        price: BigNumberish
      }

      let COMPLETE_ORACLE_VERSION: {
        version: number
        timestamp: number
        price: BigNumberish
      }

      let REFUND_AMOUNT_0: BigNumberish
      let REFUND_AMOUNT_1: BigNumberish

      const fixture = async () => {
        await increase(2 * HOUR)
        START_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 17,
        }
        await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)

        await increase(60 * DAY)
        COMPLETE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: (await currentBlockTimestamp()) - 31 * DAY,
          version: 66,
        }

        REFUND_AMOUNT_0 = utils
          .parseEther('10000')
          .mul(30 * DAY - (COMPLETE_ORACLE_VERSION.timestamp - START_ORACLE_VERSION.timestamp))
          .div(30 * DAY)
        REFUND_AMOUNT_1 = utils
          .parseEther('20000')
          .mul(60 * DAY - (COMPLETE_ORACLE_VERSION.timestamp - START_ORACLE_VERSION.timestamp))
          .div(60 * DAY)
        await product.mock['latestVersion()'].withArgs().returns(COMPLETE_ORACLE_VERSION.version)
        await product.mock.atVersion.withArgs(START_ORACLE_VERSION.version).returns(START_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns(COMPLETE_ORACLE_VERSION)
        const POST_COMPLETE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 68,
        }
        await incentivizer.connect(productSigner).sync(POST_COMPLETE_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('settles correct amount (maker position)', async () => {
        const LATEST_USER_VERSION = 70
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 80,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
      })

      it('settles correct amount (taker position)', async () => {
        const LATEST_USER_VERSION = 70
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 80,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('20'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
      })
    })

    context('over start and complete', async () => {
      let START_ORACLE_VERSION: {
        version: number
        timestamp: number
        price: BigNumberish
      }

      let COMPLETE_ORACLE_VERSION: {
        version: number
        timestamp: number
        price: BigNumberish
      }

      let REFUND_AMOUNT_0: BigNumberish
      let REFUND_AMOUNT_1: BigNumberish

      const fixture = async () => {
        await increase(2 * HOUR)
        START_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 17,
        }
        await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)

        await increase(60 * DAY)
        COMPLETE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: (await currentBlockTimestamp()) - 31 * DAY,
          version: 66,
        }

        REFUND_AMOUNT_0 = utils
          .parseEther('10000')
          .mul(30 * DAY - (COMPLETE_ORACLE_VERSION.timestamp - START_ORACLE_VERSION.timestamp))
          .div(30 * DAY)
        REFUND_AMOUNT_1 = utils
          .parseEther('20000')
          .mul(60 * DAY - (COMPLETE_ORACLE_VERSION.timestamp - START_ORACLE_VERSION.timestamp))
          .div(60 * DAY)
        await product.mock['latestVersion()'].withArgs().returns(COMPLETE_ORACLE_VERSION.version)
        await product.mock.atVersion.withArgs(START_ORACLE_VERSION.version).returns(START_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns(COMPLETE_ORACLE_VERSION)
        const POST_COMPLETE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 68,
        }
        await incentivizer.connect(productSigner).sync(POST_COMPLETE_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('settles correct amount (maker position)', async () => {
        const LATEST_USER_VERSION = 15
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 70,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(START_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555554200')
        // 16000 * 10^18 / (60 * 60 * 24 * 60) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555554200')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0).sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1).sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })

      it('settles correct amount (taker position)', async () => {
        const LATEST_USER_VERSION = 15
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 70,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('0'),
          taker: utils.parseEther('20'),
        })
        await product.mock.shareAtVersion.withArgs(START_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 2000 * 10^18 / (60 * 60 * 24 * 30) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555548800')
        // 4000 * 10^18 / (60 * 60 * 24 * 60) * 360 * 20 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555548800')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0).sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1).sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })

      it('settles correctly when user version is before versionComplete', async () => {
        const LATEST_USER_VERSION = 15
        const SETTLE_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 50,
        }
        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: await currentBlockTimestamp(),
          version: 70,
        }

        await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
        await product.mock['position(address)'].withArgs(user.address).returns({
          maker: utils.parseEther('10'),
          taker: utils.parseEther('0'),
        })
        await product.mock.shareAtVersion.withArgs(START_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(SETTLE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })
        await product.mock.shareAtVersion.withArgs(COMPLETE_ORACLE_VERSION.version).returns({
          maker: utils.parseEther('360'),
          taker: utils.parseEther('720'),
        })

        // Sync from a -> b (b before versionComplete)
        await incentivizer.connect(productSigner).syncAccount(user.address, SETTLE_ORACLE_VERSION)
        await product.mock['latestVersion(address)'].withArgs(user.address).returns(SETTLE_ORACLE_VERSION.version)

        // Sync from b -> c (c after versionComplete)
        await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

        // reward pre second * share delta * position
        // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_0 = ethers.BigNumber.from('5555555555555554200')
        // 16000 * 10^18 / (60 * 60 * 24 * 60) * 180 * 10 = 5555555555555555555
        const EXPECTED_REWARD_1 = ethers.BigNumber.from('5555555555555554200')

        expect(await incentivizer.available(product.address, 0)).to.equal(
          utils.parseEther('10000').sub(REFUND_AMOUNT_0).sub(EXPECTED_REWARD_0),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(EXPECTED_REWARD_0)

        expect(await incentivizer.available(product.address, 1)).to.equal(
          utils.parseEther('20000').sub(REFUND_AMOUNT_1).sub(EXPECTED_REWARD_1),
        )
        expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(EXPECTED_REWARD_1)
      })
    })

    it('returns zero for invalid program', async () => {
      expect(await incentivizer.unclaimed(product.address, user.address, 17)).to.equal(0)
    })

    it('reverts if not product', async () => {
      await controller.mock.isProduct.withArgs(user.address).returns(false)

      await expect(incentivizer.connect(user).syncAccount(user.address, { price: 0, timestamp: 0, version: 0 }))
        .to.be.revertedWithCustomError(incentivizer, `NotProductError`)
        .withArgs(user.address)
    })
  })

  describe('#complete', async () => {
    const fixture = async () => {
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)

      const NOW = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: NOW + HOUR,
        duration: 30 * DAY,
      })
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    context('no start first', async () => {
      it('completes correctly after before time', async () => {
        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 10,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)
        await product.mock.currentVersion.withArgs().returns(CURRENT_ORACLE_VERSION)

        await product.mock.atVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns(CURRENT_ORACLE_VERSION)

        await expect(incentivizer.connect(productOwner).complete(product.address, 0))
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(1)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          utils.parseEther('10000'),
        )
      })

      it('completes correctly after start time', async () => {
        await increase(DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 10,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)
        await product.mock.currentVersion.withArgs().returns(CURRENT_ORACLE_VERSION)

        await product.mock.atVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns(CURRENT_ORACLE_VERSION)

        await expect(incentivizer.connect(productOwner).complete(product.address, 0))
          .to.emit(incentivizer, 'ProgramStarted')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, CURRENT_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(1)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(CURRENT_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          utils.parseEther('10000'),
        )
      })
    })

    context('start first', async () => {
      let STARTED_ORACLE_VERSION: {
        price: BigNumberish
        timestamp: number
        version: number
      }

      const fixture = async () => {
        await increase(12 * HOUR)

        const NOW = await currentBlockTimestamp()
        STARTED_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: 15,
        }

        await product.mock.latestVersion.withArgs().returns(STARTED_ORACLE_VERSION.version)

        await incentivizer.connect(productSigner).sync(STARTED_ORACLE_VERSION)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('completes correctly', async () => {
        await increase(16 * DAY)

        const NOW = await currentBlockTimestamp()
        const LATEST_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW - 2 * DAY,
          version: 23,
        }

        const CURRENT_ORACLE_VERSION = {
          price: utils.parseEther('1'),
          timestamp: NOW,
          version: LATEST_ORACLE_VERSION.version + 10,
        }

        await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)
        await product.mock.currentVersion.withArgs().returns(CURRENT_ORACLE_VERSION)

        const EXPECTED_REFUND_AMOUNT = utils
          .parseEther('10000')
          .mul(30 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
          .div(30 * DAY)

        await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)
        await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

        await expect(incentivizer.connect(productOwner).complete(product.address, 0))
          .to.emit(incentivizer, 'ProgramComplete')
          .withArgs(product.address, 0, LATEST_ORACLE_VERSION.version)

        expect(await incentivizer.count(product.address)).to.equal(1)
        expect(await incentivizer.active(product.address)).to.equal(0)
        expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
        expect(await incentivizer.versionComplete(product.address, 0)).to.equal(LATEST_ORACLE_VERSION.version)
        expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(
          EXPECTED_REFUND_AMOUNT,
        )
      })
    })

    it('doesnt update if already complete', async () => {
      await increase(12 * HOUR)

      let NOW = await currentBlockTimestamp()
      const STARTED_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: NOW,
        version: 15,
      }

      await product.mock.latestVersion.withArgs().returns(STARTED_ORACLE_VERSION.version)
      await incentivizer.connect(productSigner).sync(STARTED_ORACLE_VERSION)

      await increase(31 * DAY)

      NOW = await currentBlockTimestamp()
      const LATEST_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: NOW - 2 * DAY,
        version: 23,
      }

      const CURRENT_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: NOW,
        version: LATEST_ORACLE_VERSION.version + 10,
      }

      await product.mock.latestVersion.withArgs().returns(LATEST_ORACLE_VERSION.version)

      const EXPECTED_REFUND_AMOUNT = utils
        .parseEther('10000')
        .mul(30 * DAY - (LATEST_ORACLE_VERSION.timestamp - STARTED_ORACLE_VERSION.timestamp))
        .div(30 * DAY)

      await product.mock.atVersion.withArgs(STARTED_ORACLE_VERSION.version).returns(STARTED_ORACLE_VERSION)
      await product.mock.atVersion.withArgs(LATEST_ORACLE_VERSION.version).returns(LATEST_ORACLE_VERSION)

      await incentivizer.connect(productSigner).sync(CURRENT_ORACLE_VERSION)

      await increase(31 * DAY)

      NOW = await currentBlockTimestamp()
      const NEW_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: NOW,
        version: CURRENT_ORACLE_VERSION.version + 10,
      }

      await product.mock.latestVersion.withArgs().returns(CURRENT_ORACLE_VERSION.version)
      await product.mock.currentVersion.withArgs().returns(NEW_ORACLE_VERSION)

      await incentivizer.connect(productOwner).complete(product.address, 0)

      expect(await incentivizer.count(product.address)).to.equal(1)
      expect(await incentivizer.active(product.address)).to.equal(0)
      expect(await incentivizer.versionStarted(product.address, 0)).to.equal(STARTED_ORACLE_VERSION.version)
      expect(await incentivizer.versionComplete(product.address, 0)).to.equal(LATEST_ORACLE_VERSION.version)
      expect(await incentivizer.unclaimed(product.address, productTreasury.address, 0)).to.equal(EXPECTED_REFUND_AMOUNT)
    })

    it('reverts if not valid program', async () => {
      await expect(incentivizer.connect(productOwner).complete(product.address, 1))
        .to.be.revertedWithCustomError(incentivizer, `IncentivizerInvalidProgramError`)
        .withArgs(product.address, 1)
    })

    it('reverts if not owner', async () => {
      await expect(incentivizer.connect(user).complete(product.address, 0))
        .to.be.revertedWithCustomError(incentivizer, `IncentivizerNotProgramOwnerError`)
        .withArgs(product.address, 0)
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.withArgs().returns(true)
      await expect(incentivizer.connect(productOwner).complete(product.address, 0)).to.be.revertedWithCustomError(
        incentivizer,
        `PausedError`,
      )
    })
  })

  describe('#claim', async () => {
    // reward pre second * share delta * position
    // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
    const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

    const fixture = async () => {
      // Setup programs
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwnerB.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwnerB.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
      })

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
      })

      await incentivizer.connect(productOwnerB).create(productB.address, {
        coordinatorId: 2,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
      })

      await incentivizer.connect(productOwnerB).create(productB.address, {
        coordinatorId: 2,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
      })

      // Sync global
      await increase(2 * HOUR)

      const START_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: await currentBlockTimestamp(),
        version: 17,
      }
      await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)
      await incentivizer.connect(productSignerB).sync(START_ORACLE_VERSION)

      // Sync account
      const LATEST_USER_VERSION = 20
      const CURRENT_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: await currentBlockTimestamp(),
        version: 23,
      }

      await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
      await product.mock['position(address)'].withArgs(user.address).returns({
        maker: utils.parseEther('10'),
        taker: utils.parseEther('0'),
      })
      await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
        maker: utils.parseEther('180'),
        taker: utils.parseEther('360'),
      })
      await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
        maker: utils.parseEther('360'),
        taker: utils.parseEther('720'),
      })
      await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

      await productB.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
      await productB.mock['position(address)'].withArgs(user.address).returns({
        maker: utils.parseEther('10'),
        taker: utils.parseEther('0'),
      })
      await productB.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
        maker: utils.parseEther('180'),
        taker: utils.parseEther('360'),
      })
      await productB.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
        maker: utils.parseEther('360'),
        taker: utils.parseEther('720'),
      })
      await incentivizer.connect(productSignerB).syncAccount(user.address, CURRENT_ORACLE_VERSION)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('claims individual product', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()
      await token.mock.transfer.withArgs(user.address, EXPECTED_REWARD).returns(true)

      await expect(incentivizer.connect(user)['claim(address,uint256[])'](product.address, [0, 1]))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, 0, EXPECTED_REWARD)
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, 1, EXPECTED_REWARD)

      expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)
      expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
    })

    it('claims individual products', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()
      await productB.mock.settleAccount.withArgs(user.address).returns()
      await token.mock.transfer.withArgs(user.address, EXPECTED_REWARD).returns(true)

      await expect(
        incentivizer.connect(user)['claim(address[],uint256[][])'](
          [product.address, productB.address],
          [
            [0, 1],
            [0, 1],
          ],
        ),
      )
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, 0, EXPECTED_REWARD)
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, 1, EXPECTED_REWARD)
        .to.emit(incentivizer, 'Claim')
        .withArgs(productB.address, user.address, 0, EXPECTED_REWARD)
        .to.emit(incentivizer, 'Claim')
        .withArgs(productB.address, user.address, 1, EXPECTED_REWARD)

      expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)
      expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
      expect(await incentivizer.unclaimed(productB.address, user.address, 0)).to.equal(0)
      expect(await incentivizer.unclaimed(productB.address, user.address, 1)).to.equal(0)
    })

    it('reverts if not valid product', async () => {
      await controller.mock['isProduct(address)'].withArgs(user.address).returns(false)
      await expect(incentivizer.connect(user)['claim(address,uint256[])'](user.address, [2]))
        .to.be.revertedWithCustomError(incentivizer, `NotProductError`)
        .withArgs(user.address)
    })

    it('reverts if not valid program (single)', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()

      await expect(incentivizer.connect(user)['claim(address,uint256[])'](product.address, [2]))
        .to.be.revertedWithCustomError(incentivizer, `IncentivizerInvalidProgramError`)
        .withArgs(product.address, 2)
    })

    it('reverts if not valid program (multiple)', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()

      await expect(
        incentivizer.connect(user)['claim(address[],uint256[][])']([product.address, productB.address], [[2], [1]]),
      )
        .to.be.revertedWithCustomError(incentivizer, `IncentivizerInvalidProgramError`)
        .withArgs(product.address, 2)
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.withArgs().returns(true)
      await expect(
        incentivizer.connect(user)['claim(address,uint256[])'](product.address, [1]),
      ).to.be.revertedWithCustomError(incentivizer, `PausedError`)
    })

    it('reverts if argument lengths mismatch', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()
      await productB.mock.settleAccount.withArgs(user.address).returns()
      await token.mock.transfer.withArgs(user.address, EXPECTED_REWARD).returns(true)

      await expect(
        incentivizer.connect(user)['claim(address[],uint256[][])']([product.address, productB.address], [[0, 1]]),
      ).to.be.revertedWithCustomError(incentivizer, 'IncentivizerBatchClaimArgumentMismatchError')
    })
  })

  describe('#claimFor', async () => {
    // reward pre second * share delta * position
    // 8000 * 10^18 / (60 * 60 * 24 * 30) * 180 * 10 = 5555555555555555555
    const EXPECTED_REWARD = ethers.BigNumber.from('5555555555555554200')

    const fixture = async () => {
      // Setup programs
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwnerB.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwnerB.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
      })

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
      })

      await incentivizer.connect(productOwnerB).create(productB.address, {
        coordinatorId: 2,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
      })

      await incentivizer.connect(productOwnerB).create(productB.address, {
        coordinatorId: 2,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
      })

      // Sync global
      await increase(2 * HOUR)

      const START_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: await currentBlockTimestamp(),
        version: 17,
      }
      await incentivizer.connect(productSigner).sync(START_ORACLE_VERSION)
      await incentivizer.connect(productSignerB).sync(START_ORACLE_VERSION)

      // Sync account
      const LATEST_USER_VERSION = 20
      const CURRENT_ORACLE_VERSION = {
        price: utils.parseEther('1'),
        timestamp: await currentBlockTimestamp(),
        version: 23,
      }

      await product.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
      await product.mock['position(address)'].withArgs(user.address).returns({
        maker: utils.parseEther('10'),
        taker: utils.parseEther('0'),
      })
      await product.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
        maker: utils.parseEther('180'),
        taker: utils.parseEther('360'),
      })
      await product.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
        maker: utils.parseEther('360'),
        taker: utils.parseEther('720'),
      })
      await incentivizer.connect(productSigner).syncAccount(user.address, CURRENT_ORACLE_VERSION)

      await productB.mock['latestVersion(address)'].withArgs(user.address).returns(LATEST_USER_VERSION)
      await productB.mock['position(address)'].withArgs(user.address).returns({
        maker: utils.parseEther('10'),
        taker: utils.parseEther('0'),
      })
      await productB.mock.shareAtVersion.withArgs(LATEST_USER_VERSION).returns({
        maker: utils.parseEther('180'),
        taker: utils.parseEther('360'),
      })
      await productB.mock.shareAtVersion.withArgs(CURRENT_ORACLE_VERSION.version).returns({
        maker: utils.parseEther('360'),
        taker: utils.parseEther('720'),
      })
      await incentivizer.connect(productSignerB).syncAccount(user.address, CURRENT_ORACLE_VERSION)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('claims individual product for user', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()
      await token.mock.transfer.withArgs(user.address, EXPECTED_REWARD).returns(true)

      await expect(incentivizer.connect(multiInvokerMock).claimFor(user.address, product.address, [0, 1]))
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, 0, EXPECTED_REWARD)
        .to.emit(incentivizer, 'Claim')
        .withArgs(product.address, user.address, 1, EXPECTED_REWARD)

      expect(await incentivizer.unclaimed(product.address, user.address, 0)).to.equal(0)
      expect(await incentivizer.unclaimed(product.address, user.address, 1)).to.equal(0)
    })

    it('reverts if not called by multiinvoker or user', async () => {
      await expect(incentivizer.connect(owner).claimFor(user.address, user.address, [2]))
        .to.be.revertedWithCustomError(incentivizer, 'NotAccountOrMultiInvokerError')
        .withArgs(user.address, owner.address)
    })

    it('reverts if not valid product', async () => {
      await controller.mock['isProduct(address)'].withArgs(user.address).returns(false)
      await expect(incentivizer.connect(multiInvokerMock).claimFor(user.address, user.address, [2]))
        .to.be.revertedWithCustomError(incentivizer, 'NotProductError')
        .withArgs(user.address)
    })

    it('reverts if not valid program (single)', async () => {
      await product.mock.settleAccount.withArgs(user.address).returns()

      await expect(incentivizer.connect(multiInvokerMock).claimFor(user.address, product.address, [2]))
        .to.be.revertedWithCustomError(incentivizer, 'IncentivizerInvalidProgramError')
        .withArgs(product.address, 2)
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.withArgs().returns(true)
      await expect(
        incentivizer.connect(multiInvokerMock).claimFor(user.address, product.address, [1]),
      ).to.be.revertedWithCustomError(incentivizer, `PausedError`)
    })
  })

  describe('#claimFee', async () => {
    const fixture = async () => {
      await controller.mock.incentivizationFee.withArgs().returns(utils.parseEther('0.01'))

      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('10000'))
        .returns(true)
      await token.mock.transferFrom
        .withArgs(productOwner.address, incentivizer.address, utils.parseEther('20000'))
        .returns(true)

      const now = await currentBlockTimestamp()

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('8000'),
          taker: utils.parseEther('2000'),
        },
        start: now + HOUR,
        duration: 30 * DAY,
      })

      await incentivizer.connect(productOwner).create(product.address, {
        coordinatorId: PRODUCT_COORDINATOR_ID,
        token: token.address,
        amount: {
          maker: utils.parseEther('16000'),
          taker: utils.parseEther('4000'),
        },
        start: now + HOUR,
        duration: 60 * DAY,
      })
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('claims accrued fees', async () => {
      await token.mock.transfer.withArgs(treasury.address, utils.parseEther('300')).returns(true)

      await expect(incentivizer.connect(user).claimFee([token.address]))
        .to.emit(incentivizer, 'FeeClaim')
        .withArgs(token.address, utils.parseEther('300'))

      expect(await incentivizer.fees(token.address)).to.equal(0)
    })

    it('reverts if paused (protocol)', async () => {
      await controller.mock.paused.withArgs().returns(true)
      await expect(incentivizer.connect(user).claimFee([token.address])).to.be.revertedWithCustomError(
        incentivizer,
        `PausedError`,
      )
    })
  })

  context('invalid program', () => {
    describe('#owner', () => {
      it('reverts', async () => {
        await expect(incentivizer.owner(product.address, 0)).to.be.revertedWithCustomError(
          incentivizer,
          'IncentivizerInvalidProgramError',
        )
      })
    })

    describe('#treasury', () => {
      it('reverts', async () => {
        await expect(incentivizer['treasury(address,uint256)'](product.address, 0)).to.be.revertedWithCustomError(
          incentivizer,
          'IncentivizerInvalidProgramError',
        )
      })
    })
  })
})

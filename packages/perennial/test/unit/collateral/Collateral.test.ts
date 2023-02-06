import { MockContract, deployMockContract } from '@ethereum-waffle/mock-contract'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { constants, utils, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { impersonate } from '../../../../common/testutil'

import {
  Collateral,
  Collateral__factory,
  Controller__factory,
  IERC20Metadata__factory,
  Product__factory,
} from '../../../types/generated'

const { ethers } = HRE

describe('Collateral', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let multiInvokerMock: SignerWithAddress
  let treasuryA: SignerWithAddress
  let treasuryB: SignerWithAddress
  let notProduct: SignerWithAddress
  let controller: MockContract
  let token: MockContract
  let product: MockContract
  let productSigner: SignerWithAddress

  let collateral: Collateral

  const collateralFixture = async () => {
    ;[owner, user, userB, treasuryA, treasuryB, notProduct, multiInvokerMock] = await ethers.getSigners()

    token = await deployMockContract(owner, IERC20Metadata__factory.abi)
    await token.mock.decimals.returns(18)

    product = await deployMockContract(owner, Product__factory.abi)
    productSigner = await impersonate.impersonateWithBalance(product.address, utils.parseEther('10'))

    controller = await deployMockContract(owner, Controller__factory.abi)
    await controller.mock.paused.withArgs().returns(false)
    await controller.mock.liquidationFee.withArgs().returns(utils.parseEther('0.5'))
    await controller.mock.minCollateral.withArgs().returns(0)
    await controller.mock.isProduct.withArgs(product.address).returns(true)
    await controller.mock.isProduct.withArgs(notProduct.address).returns(false)
    await controller.mock.multiInvoker.withArgs().returns(multiInvokerMock.address)

    collateral = await new Collateral__factory(owner).deploy(token.address)
    await collateral.initialize(controller.address)
  }

  beforeEach(async () => {
    await loadFixture(collateralFixture)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await collateral.controller()).to.equal(controller.address)
      expect(await collateral.token()).to.equal(token.address)
    })

    it('reverts if already initialized', async () => {
      await expect(collateral.initialize(controller.address))
        .to.be.revertedWithCustomError(collateral, 'UInitializableAlreadyInitializedError')
        .withArgs(1)
    })

    it('reverts if controller is zero address', async () => {
      const collateralFresh = await new Collateral__factory(owner).deploy(token.address)
      await expect(collateralFresh.initialize(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
        collateralFresh,
        'InvalidControllerError',
      )
    })
  })

  describe('#depositTo', async () => {
    it('deposits to the user account', async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await expect(collateral.connect(owner).depositTo(user.address, product.address, 100))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, product.address, 100)

      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(100)
      expect(await collateral['collateral(address)'](product.address)).to.equal(100)
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.withArgs().returns(true)
      await expect(
        collateral.connect(owner).depositTo(user.address, product.address, 100),
      ).to.be.revertedWithCustomError(collateral, 'PausedError')
    })

    it('reverts if zero address', async () => {
      await expect(
        collateral.connect(owner).depositTo(ethers.constants.AddressZero, product.address, 100),
      ).to.be.revertedWithCustomError(collateral, `CollateralZeroAddressError`)
    })

    it('reverts if not product', async () => {
      await expect(collateral.connect(owner).depositTo(user.address, notProduct.address, 100))
        .to.be.revertedWithCustomError(collateral, `NotProductError`)
        .withArgs(notProduct.address)
    })

    it('reverts if below limit', async () => {
      await controller.mock.minCollateral.withArgs().returns(100)
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 80).returns(true)

      await expect(
        collateral.connect(owner).depositTo(user.address, product.address, 80),
      ).to.be.revertedWithCustomError(collateral, 'CollateralUnderLimitError')
    })

    describe('multiple users per product', async () => {
      const fixture = async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.connect(owner).depositTo(user.address, product.address, 100)
      }

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('adds to both totals', async () => {
        await expect(collateral.connect(owner).depositTo(userB.address, product.address, 100))
          .to.emit(collateral, 'Deposit')
          .withArgs(userB.address, product.address, 100)

        expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(100)
        expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(100)
        expect(await collateral['collateral(address)'](product.address)).to.equal(200)
      })
    })
  })

  describe('withdrawals', () => {
    const WITHDRAWAL_METHODS = [
      {
        method: '#withdrawTo',
        fn: (address: string, product: string, amount: BigNumberish) =>
          collateral.connect(user).withdrawTo(address, product, amount),
      },
      {
        method: '#withdrawFrom',
        fn: (address: string, product: string, amount: BigNumberish) =>
          collateral.connect(multiInvokerMock).withdrawFrom(user.address, address, product, amount),
      },
    ]

    beforeEach(async () => {
      // Mock settle calls
      await product.mock.settleAccount.withArgs(user.address).returns()
      await product.mock.settleAccount.withArgs(userB.address).returns()

      // Mock maintenance calls
      await product.mock.maintenance.withArgs(user.address).returns(0)
      await product.mock.maintenanceNext.withArgs(user.address).returns(0)
      await product.mock.maintenance.withArgs(userB.address).returns(0)
      await product.mock.maintenanceNext.withArgs(userB.address).returns(0)

      //Pre-fill account
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.connect(owner).depositTo(user.address, product.address, 100)
    })

    WITHDRAWAL_METHODS.forEach(({ method, fn }) => {
      describe(method, async () => {
        it('withdraws from the user account', async () => {
          await token.mock.transfer.withArgs(owner.address, 80).returns(true)
          await expect(fn(owner.address, product.address, 80))
            .to.emit(collateral, 'Withdrawal')
            .withArgs(user.address, product.address, 80)

          expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(20)
          expect(await collateral['collateral(address)'](product.address)).to.equal(20)
        })

        it('withdraws all deposited if amount == MAX', async () => {
          await token.mock.transfer.withArgs(owner.address, 100).returns(true)
          await expect(fn(owner.address, product.address, constants.MaxUint256))
            .to.emit(collateral, 'Withdrawal')
            .withArgs(user.address, product.address, 100)

          expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
          expect(await collateral['collateral(address)'](product.address)).to.equal(0)
        })

        it('reverts if paused', async () => {
          await controller.mock.paused.withArgs().returns(true)
          await expect(fn(user.address, product.address, 80)).to.be.revertedWithCustomError(collateral, 'PausedError')
        })

        it('reverts if zero address', async () => {
          await expect(fn(ethers.constants.AddressZero, product.address, 100)).to.be.revertedWithCustomError(
            collateral,
            `CollateralZeroAddressError`,
          )
        })

        it('reverts if not product', async () => {
          await expect(fn(user.address, notProduct.address, 100))
            .to.be.revertedWithCustomError(collateral, `NotProductError`)
            .withArgs(notProduct.address)
        })

        it('reverts if below limit', async () => {
          await controller.mock.minCollateral.withArgs().returns(50)
          await token.mock.transfer.withArgs(user.address, 80).returns(true)

          await expect(fn(user.address, product.address, 80)).to.be.revertedWithCustomError(
            collateral,
            'CollateralUnderLimitError',
          )
        })

        it('reverts if liquidatable current', async () => {
          await product.mock.maintenance.withArgs(user.address).returns(50)
          await product.mock.maintenanceNext.withArgs(user.address).returns(100)

          await token.mock.transfer.withArgs(user.address, 80).returns(true)
          await expect(fn(user.address, product.address, 80)).to.be.revertedWithCustomError(
            collateral,
            'CollateralInsufficientCollateralError',
          )
        })

        it('reverts if liquidatable next', async () => {
          await product.mock.maintenance.withArgs(user.address).returns(100)
          await product.mock.maintenanceNext.withArgs(user.address).returns(50)

          await token.mock.transfer.withArgs(user.address, 80).returns(true)
          await expect(fn(user.address, product.address, 80)).to.be.revertedWithCustomError(
            collateral,
            'CollateralInsufficientCollateralError',
          )
        })

        describe('multiple users per product', async () => {
          const fixture = async () => {
            await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
            await collateral.connect(owner).depositTo(userB.address, product.address, 100)
            await token.mock.transfer.withArgs(owner.address, 80).returns(true)
            await fn(owner.address, product.address, 80)
          }

          beforeEach(async () => {
            await loadFixture(fixture)
          })

          it('subtracts from both totals', async () => {
            await expect(collateral.connect(userB).withdrawTo(owner.address, product.address, 80))
              .to.emit(collateral, 'Withdrawal')
              .withArgs(userB.address, product.address, 80)

            expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(20)
            expect(await collateral['collateral(address,address)'](userB.address, product.address)).to.equal(20)
            expect(await collateral['collateral(address)'](product.address)).to.equal(40)
          })
        })

        describe('shortfall', async () => {
          const fixture = async () => {
            await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
            await collateral.connect(owner).depositTo(userB.address, product.address, 100)

            await collateral.connect(productSigner).settleAccount(userB.address, -150)
            await collateral.connect(productSigner).settleAccount(user.address, 150)
          }

          beforeEach(async () => {
            await loadFixture(fixture)
          })

          it('reverts if depleted', async () => {
            expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(250)
            expect(await collateral['collateral(address)'](product.address)).to.equal(200)
            expect(await collateral.shortfall(product.address)).to.equal(50)

            await expect(fn(user.address, product.address, 250)).to.be.revertedWithPanic('0x11') // underflow
          })
        })

        describe('shortfall (multiple)', async () => {
          const fixture = async () => {
            await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
            await collateral.connect(owner).depositTo(userB.address, product.address, 100)

            await collateral.connect(productSigner).settleAccount(userB.address, -150)
            await collateral.connect(productSigner).settleAccount(userB.address, -50)
            await collateral.connect(productSigner).settleAccount(user.address, 150)
            await collateral.connect(productSigner).settleAccount(user.address, 50)
          }

          beforeEach(async () => {
            await loadFixture(fixture)
          })

          it('reverts if depleted', async () => {
            expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(300)
            expect(await collateral['collateral(address)'](product.address)).to.equal(200)
            expect(await collateral.shortfall(product.address)).to.equal(100)

            await expect(fn(user.address, product.address, 300)).to.be.revertedWithPanic('0x11') // underflow
          })
        })
      })
    })

    describe('#withdrawFrom permissions', () => {
      it('reverts if not from user or multiinvoker', async () => {
        await expect(
          collateral.connect(userB).withdrawFrom(user.address, userB.address, product.address, utils.parseEther('100')),
        )
          .to.be.revertedWithCustomError(collateral, 'NotAccountOrMultiInvokerError')
          .withArgs(user.address, userB.address)
      })
    })
  })

  describe('#settleAccount', async () => {
    it('credits the account', async () => {
      await expect(collateral.connect(productSigner).settleAccount(user.address, 101))
        .to.emit(collateral, 'AccountSettle')
        .withArgs(product.address, user.address, 101, 0)
      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(101)
      expect(await collateral['collateral(address)'](product.address)).to.equal(0)
    })

    context('negative credit', async () => {
      it('doesnt create a shortfall', async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.depositTo(user.address, product.address, 100)

        await expect(collateral.connect(productSigner).settleAccount(user.address, -99))
          .to.emit(collateral, 'AccountSettle')
          .withArgs(product.address, user.address, -99, 0)

        expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(1)
        expect(await collateral['collateral(address)'](product.address)).to.equal(100)
        expect(await collateral.shortfall(product.address)).to.equal(0)
      })

      it('creates a shortfall', async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.depositTo(user.address, product.address, 100)

        await expect(collateral.connect(productSigner).settleAccount(user.address, -101))
          .to.emit(collateral, 'AccountSettle')
          .withArgs(product.address, user.address, -101, 1)

        expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
        expect(await collateral['collateral(address)'](product.address)).to.equal(100)
        expect(await collateral.shortfall(product.address)).to.equal(1)
      })
    })

    it('reverts if not product', async () => {
      await controller.mock.isProduct.withArgs(user.address).returns(false)

      await expect(collateral.connect(user).settleAccount(user.address, 101))
        .to.be.revertedWithCustomError(collateral, `NotProductError`)
        .withArgs(user.address)
    })
  })

  describe('#settleProduct', async () => {
    const settleProductFixture = async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, product.address, 100)

      await controller.mock['treasury()'].returns(treasuryA.address)
      await controller.mock['treasury(address)'].withArgs(product.address).returns(treasuryB.address)
      await controller.mock.protocolFee.returns(utils.parseEther('0.1'))
    }

    beforeEach(async () => {
      await loadFixture(settleProductFixture)
    })

    it('settles the product fee', async () => {
      await expect(collateral.connect(productSigner).settleProduct(90))
        .to.emit(collateral, 'ProductSettle')
        .withArgs(product.address, 9, 81)

      expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(100)

      expect(await collateral['collateral(address)'](product.address)).to.equal(10)
      expect(await collateral.shortfall(product.address)).to.equal(0)
      expect(await collateral.fees(treasuryA.address)).to.equal(9)
      expect(await collateral.fees(treasuryB.address)).to.equal(81)
    })

    it('reverts if product shortfall', async () => {
      await expect(collateral.connect(productSigner).settleProduct(110)).to.be.revertedWithPanic(`0x11`)
    })

    it('reverts if not product', async () => {
      await controller.mock.isProduct.withArgs(user.address).returns(false)

      await expect(collateral.connect(user).settleProduct(90))
        .to.be.revertedWithCustomError(collateral, `NotProductError`)
        .withArgs(user.address)
    })
  })

  describe('#liquidate', async () => {
    const liquidateFixture = async () => {
      // Setup the with 100 underlying collateral
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, product.address, 100)

      // Mock settle calls
      await product.mock.settleAccount.withArgs(user.address).returns()

      // Mock isLiquidating calls
      await product.mock.isLiquidating.withArgs(user.address).returns(false)
    }

    beforeEach(async () => {
      await loadFixture(liquidateFixture)
    })

    context('user not liquidatable', async () => {
      it('reverts without liquidating', async () => {
        await product.mock.maintenance.withArgs(user.address).returns(10)

        expect(await collateral.liquidatable(user.address, product.address)).to.equal(false)

        await expect(collateral.liquidate(user.address, product.address))
          .to.be.revertedWithCustomError(collateral, 'CollateralCantLiquidate')
          .withArgs(10, 100)
      })
    })

    context('user liquidatable', async () => {
      it('liquidates the user', async () => {
        await product.mock.maintenance.withArgs(user.address).returns(101)
        await product.mock.closeAll.withArgs(user.address).returns()
        await token.mock.transfer.withArgs(owner.address, 50).returns(true)

        expect(await collateral.liquidatable(user.address, product.address)).to.equal(true)

        await expect(collateral.liquidate(user.address, product.address))
          .to.emit(collateral, 'Liquidation')
          .withArgs(user.address, product.address, owner.address, 50)

        expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(50)
        expect(await collateral['collateral(address)'](product.address)).to.equal(50)
      })

      it('calculates fee on minCollateral if maintenance < minCollateral', async () => {
        await controller.mock.minCollateral.returns(120)
        await product.mock.maintenance.withArgs(user.address).returns(101)
        await product.mock.closeAll.withArgs(user.address).returns()
        await token.mock.transfer.withArgs(owner.address, 60).returns(true)

        expect(await collateral.liquidatable(user.address, product.address)).to.equal(true)

        await expect(collateral.liquidate(user.address, product.address))
          .to.emit(collateral, 'Liquidation')
          .withArgs(user.address, product.address, owner.address, 60)

        expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(40)
        expect(await collateral['collateral(address)'](product.address)).to.equal(40)
      })

      it('limits fee to total collateral', async () => {
        await product.mock.maintenance.withArgs(user.address).returns(210)
        await product.mock.closeAll.withArgs(user.address).returns()
        await token.mock.transfer.withArgs(owner.address, 100).returns(true)

        expect(await collateral.liquidatable(user.address, product.address)).to.equal(true)

        await expect(collateral.liquidate(user.address, product.address))
          .to.emit(collateral, 'Liquidation')
          .withArgs(user.address, product.address, owner.address, 100)

        expect(await collateral['collateral(address,address)'](user.address, product.address)).to.equal(0)
        expect(await collateral['collateral(address)'](product.address)).to.equal(0)
      })

      it('reverts if paused', async () => {
        await controller.mock.paused.withArgs().returns(true)
        await expect(collateral.liquidate(user.address, product.address)).to.be.revertedWithCustomError(
          collateral,
          'PausedError',
        )
      })

      it('reverts if not product', async () => {
        await expect(collateral.liquidate(user.address, notProduct.address))
          .to.be.revertedWithCustomError(collateral, `NotProductError`)
          .withArgs(notProduct.address)
      })

      it('reverts if already liquidating', async () => {
        await product.mock.isLiquidating.withArgs(user.address).returns(true)

        await expect(collateral.liquidate(user.address, product.address))
          .to.be.revertedWithCustomError(collateral, 'CollateralAccountLiquidatingError')
          .withArgs(user.address)
      })
    })
  })

  describe('#liquidatable', async () => {
    const fixture = async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, product.address, 100)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('returns true if below maintenance', async () => {
      await product.mock.isLiquidating.withArgs(user.address).returns(false)
      await product.mock.maintenance.withArgs(user.address).returns(101)

      expect(await collateral.liquidatable(user.address, product.address)).to.equal(true)
    })

    it('returns false if above maintenance', async () => {
      await product.mock.isLiquidating.withArgs(user.address).returns(false)
      await product.mock.maintenance.withArgs(user.address).returns(99)

      expect(await collateral.liquidatable(user.address, product.address)).to.equal(false)
    })

    it('returns false if already liquidating', async () => {
      await product.mock.isLiquidating.withArgs(user.address).returns(true)

      expect(await collateral.liquidatable(user.address, product.address)).to.equal(false)
    })
  })

  describe('#liquidatableNext', async () => {
    const fixture = async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, product.address, 100)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('returns true', async () => {
      await product.mock.maintenanceNext.withArgs(user.address).returns(101)

      expect(await collateral.liquidatableNext(user.address, product.address)).to.equal(true)
    })

    it('returns false', async () => {
      await product.mock.maintenanceNext.withArgs(user.address).returns(99)

      expect(await collateral.liquidatableNext(user.address, product.address)).to.equal(false)
    })
  })

  describe('#resolveShortfall', async () => {
    const fixture = async () => {
      await collateral.connect(productSigner).settleAccount(user.address, -100)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('pays off the shortfall', async () => {
      await token.mock.transferFrom.withArgs(user.address, collateral.address, 90).returns(true)

      await expect(collateral.connect(user).resolveShortfall(product.address, 90))
        .to.emit(collateral, 'ShortfallResolution')
        .withArgs(product.address, 90)

      expect(await collateral['collateral(address)'](product.address)).to.equal(90)
      expect(await collateral.shortfall(product.address)).to.equal(10)
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.withArgs().returns(true)
      await expect(collateral.connect(user).resolveShortfall(product.address, 90)).to.be.revertedWithCustomError(
        collateral,
        'PausedError',
      )
    })
  })

  describe('#claimFee', async () => {
    const fixture = async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, product.address, 100)

      await controller.mock['treasury()'].returns(treasuryA.address)
      await controller.mock['treasury(address)'].withArgs(product.address).returns(treasuryB.address)
      await controller.mock.protocolFee.returns(utils.parseEther('0.1'))

      await collateral.connect(productSigner).settleProduct(90)
    }

    beforeEach(async () => {
      await loadFixture(fixture)
    })

    it('claims fee', async () => {
      await token.mock.transfer.withArgs(treasuryA.address, 9).returns(true)
      await token.mock.transfer.withArgs(treasuryB.address, 81).returns(true)

      await expect(collateral.connect(treasuryA).claimFee())
        .to.emit(collateral, 'FeeClaim')
        .withArgs(treasuryA.address, 9)

      await expect(collateral.connect(treasuryB).claimFee())
        .to.emit(collateral, 'FeeClaim')
        .withArgs(treasuryB.address, 81)

      expect(await collateral.fees(treasuryA.address)).to.equal(0)
      expect(await collateral.fees(treasuryB.address)).to.equal(0)
    })

    it('reverts if paused', async () => {
      await controller.mock.paused.returns(true)
      await expect(collateral.connect(treasuryB).claimFee()).to.be.revertedWithCustomError(collateral, 'PausedError')
    })
  })
})

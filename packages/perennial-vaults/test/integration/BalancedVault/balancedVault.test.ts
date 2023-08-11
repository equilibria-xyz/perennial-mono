import HRE from 'hardhat'
import { time, impersonate } from '../../../../common/testutil'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IController,
  IController__factory,
  IProduct,
  IProduct__factory,
  BalancedVault,
  BalancedVault__factory,
  IOracleProvider__factory,
  IOracleProvider,
  ICollateral,
  ICollateral__factory,
} from '../../../types/generated'
import { BigNumber, constants, utils } from 'ethers'

const { config, ethers } = HRE
use(smock.matchers)

const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

describe('BalancedVault', () => {
  let vault: BalancedVault
  let asset: IERC20Metadata
  let oracle: FakeContract<IOracleProvider>
  let collateral: ICollateral
  let controller: IController
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let perennialUser: SignerWithAddress
  let liquidator: SignerWithAddress
  let long: IProduct
  let short: IProduct
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber

  async function updateOracle(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await oracle.currentVersion()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
    }
    oracle.sync.returns(newVersion)
    oracle.currentVersion.returns(newVersion)
    oracle.atVersion.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function updateOracleAndSync(newPrice?: BigNumber) {
    await updateOracle(newPrice)
    await vault.sync()
  }

  async function longPosition() {
    return (await long.position(vault.address)).maker
  }

  async function shortPosition() {
    return (await short.position(vault.address)).maker
  }

  async function longCollateralInVault() {
    return await collateral['collateral(address,address)'](vault.address, long.address)
  }

  async function shortCollateralInVault() {
    return await collateral['collateral(address,address)'](vault.address, short.address)
  }

  async function totalCollateralInVault() {
    return (await longCollateralInVault()).add(await shortCollateralInVault()).add(await asset.balanceOf(vault.address))
  }

  beforeEach(async () => {
    await time.reset(config)
    ;[owner, user, user2, liquidator, perennialUser] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)
    long = IProduct__factory.connect('0xdB60626FF6cDC9dB07d3625A93d21dDf0f8A688C', owner)
    short = IProduct__factory.connect('0xfeD3E166330341e0305594B8c6e6598F9f4Cbe9B', owner)
    collateral = ICollateral__factory.connect('0x2d264ebdb6632a06a1726193d4d37fef1e5dbdcd', owner)
    leverage = utils.parseEther('4.0')
    maxCollateral = utils.parseEther('500000')

    vault = await new BalancedVault__factory(owner).deploy(
      controller.address,
      leverage,
      maxCollateral,
      [
        {
          long: long.address,
          short: short.address,
          weight: 1,
        },
      ],
      ethers.constants.AddressZero,
    )
    await vault.initialize('Perennial Vault Alpha')
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuMinter = await impersonate.impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
    const setUpWalletWithDSU = async (wallet: SignerWithAddress, amount?: BigNumber) => {
      const dsuIface = new utils.Interface(['function mint(uint256)'])
      await dsuMinter.sendTransaction({
        to: dsu.address,
        value: 0,
        data: dsuIface.encodeFunctionData('mint', [amount ?? utils.parseEther('200000')]),
      })
      await dsu.connect(dsuMinter).transfer(wallet.address, amount ?? utils.parseEther('200000'))
      await dsu.connect(wallet).approve(vault.address, ethers.constants.MaxUint256)
    }
    await setUpWalletWithDSU(user)
    await setUpWalletWithDSU(user2)
    await setUpWalletWithDSU(liquidator)
    await setUpWalletWithDSU(perennialUser, utils.parseEther('1000000'))

    // Unfortunately, we can't make mocks of existing contracts.
    // So, we make a fake and initialize it with the values that the real contract had at this block.
    const realOracle = IOracleProvider__factory.connect('0xA59eF0208418559770a48D7ae4f260A28763167B', owner)
    const currentVersion = await realOracle.currentVersion()
    originalOraclePrice = currentVersion[2]

    oracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: '0x2C19eac953048801FfE1358D109A1Ac2aF7930fD',
    })
    oracle.sync.returns(currentVersion)
    oracle.currentVersion.returns(currentVersion)
    oracle.atVersion.whenCalledWith(currentVersion[0]).returns(currentVersion)
  })

  describe('#constructor', () => {
    it('checks that there is at least one market', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionNoMarketsError')
    })

    it('checks that at least one weight is greater than zero', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 0,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionAllZeroWeightError')

      // At least one of the weights can be zero as long as not all of them are.
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 0,
            },
            {
              long: long.address,
              short: short.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.not.be.reverted
    })

    it('checks that all products are valid', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: '0x0000000000000000000000000000000000000000',
              short: short.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultInvalidProductError')
    })

    it('checks that target leverage is positive', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          0,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionZeroTargetLeverageError')
    })

    it('checks that the long and short are not identical', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: long.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionLongAndShortAreSameProductError')
    })
  })

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(vault.initialize('Perennial Vault Alpha')).to.revertedWithCustomError(
        vault,
        'UInitializableAlreadyInitializedError',
      )
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Perennial Vault Alpha')
    })
  })

  describe('#approve', () => {
    it('approves correctly', async () => {
      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)

      await expect(vault.connect(user).approve(liquidator.address, utils.parseEther('10')))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, utils.parseEther('10'))

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(utils.parseEther('10'))

      await expect(vault.connect(user).approve(liquidator.address, 0))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, 0)

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)
    })
  })

  describe('#deposit/#redeem/#claim/#sync', () => {
    it('simple deposits and withdraws', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('10')
      await vault.connect(user).deposit(smallDeposit, user.address)
      expect(await longCollateralInVault()).to.equal(0)
      expect(await shortCollateralInVault()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.sync()

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      expect(await longCollateralInVault()).to.equal(utils.parseEther('5005'))
      expect(await shortCollateralInVault()).to.equal(utils.parseEther('5005'))
      expect(await vault.balanceOf(user.address)).to.equal(smallDeposit)
      expect(await vault.totalSupply()).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(utils.parseEther('10'))).to.equal(utils.parseEther('10'))
      expect(await vault.convertToShares(utils.parseEther('10'))).to.equal(utils.parseEther('10'))
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10010'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10010'))
      expect(await vault.totalAssets()).to.equal(utils.parseEther('10010'))
      expect(await vault.convertToAssets(utils.parseEther('10010'))).to.equal(utils.parseEther('10010'))
      expect(await vault.convertToShares(utils.parseEther('10010'))).to.equal(utils.parseEther('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice),
      )

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await expect(vault.connect(user2).redeem(1, user2.address)).to.be.revertedWithCustomError(
        vault,
        'BalancedVaultRedemptionLimitExceeded',
      )

      expect(await vault.maxRedeem(user.address)).to.equal(utils.parseEther('10010'))
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('1526207855124')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('10010').add(fundingAmount))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('10010').add(fundingAmount))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('10010').add(fundingAmount))

      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await vault.unclaimed(user.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('multiple users', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from(156261444735)
      const balanceOf2 = BigNumber.from('9999999998437385552894')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('308321913166')
      const fundingAmount2 = BigNumber.from('3045329143208')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('deposit during withdraw', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const largeDeposit = utils.parseEther('2000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await vault.connect(user).redeem(utils.parseEther('400'), user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).sub(utils.parseEther('400')).mul(leverage).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        smallDeposit.add(largeDeposit).sub(utils.parseEther('400')).mul(leverage).div(2).div(originalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('93756866841')
      const balanceOf2 = BigNumber.from('1999999999687477110578')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('600'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('2600').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('600').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('600').add(balanceOf2))).to.equal(
        utils.parseEther('2600').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('2600').add(fundingAmount0))).to.equal(
        utils.parseEther('600').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('249607634342')
      const fundingAmount2 = BigNumber.from('622820158534')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('3000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('2000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('3000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('maxRedeem', async () => {
      const smallDeposit = utils.parseEther('500')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const shareAmount = BigNumber.from(utils.parseEther('500'))
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount)

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const shareAmount2 = BigNumber.from('9999999998435236774264')
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to withdraw more than maxRedeem.
      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWithCustomError(vault, 'BalancedVaultRedemptionLimitExceeded')

      // But we should be able to withdraw exactly maxRedeem.
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)

      // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
      expect(await vault.maxRedeem(user.address)).to.equal(0)

      // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
      await updateOracle()
      await vault.sync()

      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.claim(user.address)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('maxRedeem with close limited', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const globalPre = await long['pre()']()
      const globalPosition = await long.positionAtVersion(await long['latestVersion()']())
      const globalNext = {
        maker: globalPosition.maker.add(globalPre.openPosition.maker.sub(globalPre.closePosition.maker)),
        taker: globalPosition.taker.add(globalPre.openPosition.taker.sub(globalPre.closePosition.taker)),
      }

      // Open taker position up to 100% utilization minus 1 ETH
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, long.address, utils.parseEther('1000000'))
      await long.connect(perennialUser).openTake(globalNext.maker.sub(globalNext.taker).sub(utils.parseEther('1')))

      // Settle the take position
      await updateOracle()
      await long.settle()

      // The vault can close 1 ETH of maker positions in the long market, which means the user can withdraw double this amount
      const expectedShares = await vault.convertToShares(
        originalOraclePrice.mul(utils.parseEther('1')).mul(2).div(leverage),
      )
      expect(await vault.maxRedeem(user.address)).to.equal(expectedShares)

      await vault.sync()
      const redeemAmount = (await vault.maxRedeem(user.address)).add(1)

      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWithCustomError(vault, 'BalancedVaultRedemptionLimitExceeded')

      await expect(vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)).to.not.be.reverted
    })

    it('maxDeposit', async () => {
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral)
      const depositSize = utils.parseEther('200000')

      await vault.connect(user).deposit(depositSize, user.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(depositSize))

      await vault.connect(user2).deposit(utils.parseEther('200000'), user2.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(depositSize).sub(depositSize))

      await vault.connect(liquidator).deposit(utils.parseEther('100000'), liquidator.address)
      expect(await vault.maxDeposit(user.address)).to.equal(0)

      await expect(vault.connect(liquidator).deposit(1, liquidator.address)).to.revertedWithCustomError(
        vault,
        'BalancedVaultDepositLimitExceeded',
      )
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
      await updateOracle()
      await vault.sync()

      const originalTotalCollateral = await totalCollateralInVault()

      // Collaterals should be equal.
      expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())

      await updateOracle(utils.parseEther('1300'))
      await long.connect(user).settleAccount(vault.address)
      await short.connect(user).settleAccount(vault.address)

      // Collaterals should not be equal any more.
      expect(await longCollateralInVault()).to.not.equal(await shortCollateralInVault())

      await vault.sync()

      // Collaterals should be equal again!
      expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())

      await updateOracle(originalOraclePrice)
      await vault.sync()

      // Since the price changed then went back to the original, the total collateral should have increased.
      const fundingAmount = BigNumber.from(21517482108955)
      expect(await totalCollateralInVault()).to.eq(originalTotalCollateral.add(fundingAmount))
      expect(await vault.totalAssets()).to.eq(originalTotalCollateral.add(fundingAmount))
    })

    it('rounds deposits correctly', async () => {
      const collateralDifference = async () => {
        return (await longCollateralInVault()).sub(await shortCollateralInVault()).abs()
      }
      const oddDepositAmount = utils.parseEther('10000').add(1) // 10K + 1 wei

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.sync()
      expect(await collateralDifference()).to.equal(0)
      expect(await asset.balanceOf(vault.address)).to.equal(1)

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.sync()
      expect(await collateralDifference()).to.equal(0)
    })

    it('deposit on behalf', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(liquidator).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10000'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10000'))

      await expect(vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)).to.revertedWithPanic(
        '0x11',
      )

      await vault.connect(user).approve(liquidator.address, utils.parseEther('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)
      await updateOracle()
      await vault.sync()

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('1524724459128')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(utils.parseEther('190000'))
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('210000').add(fundingAmount))
    })

    it('redeem on behalf', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10000'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10000'))

      await expect(vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)).to.revertedWithPanic(
        '0x11',
      )

      await vault.connect(user).approve(liquidator.address, utils.parseEther('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)
      await updateOracle()
      await vault.sync()

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('1524724459128')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('400000'))
      await short.connect(perennialUser).openMake(utils.parseEther('480'))
      await updateOracle()
      await vault.sync()

      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.equal(largeDeposit.mul(leverage).div(2).div(originalOraclePrice))
      const makerLimitDelta = BigNumber.from('8282802043703935198')
      expect(await shortPosition()).to.equal(makerLimitDelta)
    })

    it('exactly at makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('400000'))
      const makerAvailable = (await short.makerLimit()).sub(
        (await short.positionAtVersion(await short['latestVersion()']())).maker,
      )

      await short.connect(perennialUser).openMake(makerAvailable)
      await updateOracle()
      await vault.sync()

      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.equal(largeDeposit.mul(leverage).div(2).div(originalOraclePrice))
      expect(await shortPosition()).to.equal(0)
    })

    it('close to taker', async () => {
      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('1000000'))
      await short.connect(perennialUser).openTake(utils.parseEther('1280'))
      await updateOracle()
      await vault.sync()

      // Redeem should create a slightly greater position delta than what's available
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.sync()

      const takerMinimum = BigNumber.from('6692251470872433151')
      expect(await shortPosition()).to.equal(takerMinimum)
      expect((await short.positionAtVersion(await short['latestVersion()']()))[0]).to.equal(
        (await short.positionAtVersion(await short['latestVersion()']()))[1],
      )
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracleAndSync()

      expect(await longPosition()).to.be.greaterThan(0)
      expect(await shortPosition()).to.be.greaterThan(0)
      const productOwner = await impersonate.impersonateWithBalance(
        await controller['owner(address)'](long.address),
        utils.parseEther('10'),
      )
      await long.connect(productOwner).updateClosed(true)
      await updateOracleAndSync()
      await updateOracleAndSync()

      // We should have closed all positions
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)

      await long.connect(productOwner).updateClosed(false)
      await updateOracleAndSync()
      await updateOracleAndSync()

      // Positions should be opened back up again
      expect(await longPosition()).to.be.greaterThan(0)
      expect(await shortPosition()).to.be.greaterThan(0)
    })

    context('liquidation', () => {
      context('long', () => {
        it('recovers before being liquidated', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('4000'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 3. Sync the vault before it has a chance to get liquidated, it will work and no longer be liquidatable
          // We should still be able to deposit.
          await vault.sync()
          expect(await vault.maxDeposit(user.address)).to.equal('402312347065256226909035')
          await vault.connect(user).deposit(2, user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('4000'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit or redeem.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 4. Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await collateral.connect(liquidator).liquidate(vault.address, long.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 5. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(utils.parseEther('3000'))
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.sync()

          const finalPosition = BigNumber.from('62621983855221267778')
          const finalCollateral = BigNumber.from('46966487895388362252059')
          expect(await longPosition()).to.equal(finalPosition)
          expect(await shortPosition()).to.equal(finalPosition)
          expect(await longCollateralInVault()).to.equal(finalCollateral)
          expect(await shortCollateralInVault()).to.equal(finalCollateral)
        })
      })

      context('short', () => {
        beforeEach(async () => {
          // get utilization closer to target in order to trigger pnl on price deviation
          await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
          await collateral
            .connect(perennialUser)
            .depositTo(perennialUser.address, long.address, utils.parseEther('120000'))
          await long.connect(perennialUser).openTake(utils.parseEther('700'))
          await collateral
            .connect(perennialUser)
            .depositTo(perennialUser.address, short.address, utils.parseEther('280000'))
          await short.connect(perennialUser).openTake(utils.parseEther('1100'))
          await updateOracle()
          await vault.sync()
        })

        it('recovers before being liquidated', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the short position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('1200'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 3. Sync the vault before it has a chance to get liquidated, it will work and no longer be liquidatable
          // We should still be able to deposit.
          await vault.sync()
          expect(await vault.maxDeposit(user.address)).to.equal('396604778052719336340483')
          await vault.connect(user).deposit(2, user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('1200'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit or redeem.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 4. Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await collateral.connect(liquidator).liquidate(vault.address, short.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 5. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.sync()

          const finalPosition = BigNumber.from('169949012636167808676')
          const finalCollateral = BigNumber.from('50984710404199215353605')
          expect(await longPosition()).to.equal(finalPosition)
          expect(await shortPosition()).to.equal(finalPosition)
          expect(await longCollateralInVault()).to.equal(finalCollateral)
          expect(await shortCollateralInVault()).to.equal(finalCollateral)
        })
      })
    })

    context('insolvency', () => {
      beforeEach(async () => {
        // get utilization closer to target in order to trigger pnl on price deviation
        await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
        await collateral
          .connect(perennialUser)
          .depositTo(perennialUser.address, long.address, utils.parseEther('120000'))
        await long.connect(perennialUser).openTake(utils.parseEther('700'))
        await updateOracle()
        await vault.sync()
      })

      it('gracefully unwinds upon insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
        await updateOracle()
        await vault.sync()

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(utils.parseEther('80000'), user.address)
        await updateOracle()
        await vault.sync()

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(utils.parseEther('20000'))
        await long.connect(user).settleAccount(vault.address)
        await short.connect(user).settleAccount(vault.address)
        await long.connect(perennialUser).closeTake(utils.parseEther('700'))
        await collateral.connect(liquidator).liquidate(vault.address, long.address)

        // // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        await updateOracle(utils.parseEther('1500')) // return to normal price to let vault rebalance
        await vault.sync()
        await updateOracle()
        await vault.sync()

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('24937450010257810297106')
        const finalUnclaimed = BigNumber.from('80000014845946136115820')
        expect(await longPosition()).to.equal(finalPosition)
        expect(await shortPosition()).to.equal(finalPosition)
        expect(await longCollateralInVault()).to.equal(finalCollateral)
        expect(await shortCollateralInVault()).to.equal(finalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
          vault,
          'BalancedVaultDepositLimitExceeded',
        )

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await longCollateralInVault()).to.equal(0)
        expect(await shortCollateralInVault()).to.equal(0)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(initialBalanceOf.add(finalCollateral.mul(2)))

        // 7. Should no longer be able to deposit, vault is closed
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
          vault,
          'BalancedVaultDepositLimitExceeded',
        )
      })
    })
  })
})

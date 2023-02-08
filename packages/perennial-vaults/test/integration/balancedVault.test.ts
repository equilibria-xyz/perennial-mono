import HRE from 'hardhat'
import { time, impersonate } from '../../../common/testutil'
import { Big18Math } from '../../../common/testutil/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { assert, expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IController__factory,
  IProduct,
  IProduct__factory,
  BalancedVault,
  BalancedVault__factory,
  IOracleProvider__factory,
  IOracleProvider,
  ICollateral,
  ICollateral__factory,
} from '../../types/generated'
import { BigNumber, utils } from 'ethers'

const { config, ethers } = HRE
use(smock.matchers)

const DSU_HOLDER = '0xaef566ca7e84d1e736f999765a804687f39d9094'

describe('BalancedVault', () => {
  let vault: BalancedVault
  let asset: IERC20Metadata
  let oracle: FakeContract<IOracleProvider>
  let collateral: ICollateral
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let liquidator: SignerWithAddress
  let long: IProduct
  let short: IProduct
  let leverage: BigNumber
  let maxLeverage: BigNumber
  let fixedFloat: BigNumber
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
    ;[owner, user, user2, liquidator] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    const controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)
    long = IProduct__factory.connect('0xdB60626FF6cDC9dB07d3625A93d21dDf0f8A688C', owner)
    short = IProduct__factory.connect('0xfeD3E166330341e0305594B8c6e6598F9f4Cbe9B', owner)
    collateral = ICollateral__factory.connect('0x2d264ebdb6632a06a1726193d4d37fef1e5dbdcd', owner)
    leverage = utils.parseEther('4.0')
    maxCollateral = utils.parseEther('500000')

    vault = await new BalancedVault__factory(owner).deploy(
      dsu.address,
      controller.address,
      long.address,
      short.address,
      leverage,
      maxCollateral,
    )
    await vault.initialize('Perennial Vault Alpha', 'PVA')
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    const setUpWalletWithDSU = async (wallet: SignerWithAddress) => {
      await dsu.connect(dsuHolder).transfer(wallet.address, utils.parseEther('200000'))
      await dsu.connect(wallet).approve(vault.address, ethers.constants.MaxUint256)
    }
    await setUpWalletWithDSU(user)
    await setUpWalletWithDSU(user2)
    await setUpWalletWithDSU(liquidator)

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

  it('names are correct', async () => {
    expect(await vault.name()).to.equal('Perennial Vault Alpha')
    expect(await vault.symbol()).to.equal('PVA')
  })

  it('simple deposits and withdraws', async () => {
    const smallDeposit = utils.parseEther('10')
    await vault.connect(user).deposit(smallDeposit, user.address)
    expect(await longCollateralInVault()).to.equal(0)
    expect(await shortCollateralInVault()).to.equal(0)
    await updateOracle()
    await vault.sync()

    // We're underneath the collateral minimum, so we shouldn't have opened any positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address, { gasLimit: 1e6 })
    expect(await longCollateralInVault()).to.equal(utils.parseEther('5005'))
    expect(await shortCollateralInVault()).to.equal(utils.parseEther('5005'))
    await updateOracle()

    await vault.sync()
    expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10010'))

    // Now we should have opened positions.
    // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
    expect(await longPosition()).to.equal(smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice))
    expect(await shortPosition()).to.equal(smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice))

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
    expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('10010').add(fundingAmount))

    await vault.connect(user).claim(user.address)
    expect(await totalCollateralInVault()).to.equal(0)
    expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
  })

  it('multiple users', async () => {
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
    expect(await shortPosition()).to.equal(smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice))

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
    await vault.connect(user).claim(user.address)
    await vault.connect(user2).claim(user2.address)

    const fundingAmount = BigNumber.from('308321913166')
    const fundingAmount2 = BigNumber.from('3045329143208')
    expect(await totalCollateralInVault()).to.equal(0)
    expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
    expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
  })

  it('transferring shares', async () => {
    const smallDeposit = utils.parseEther('10')
    await vault.connect(user).deposit(smallDeposit, user.address)
    expect(await longCollateralInVault()).to.equal(0)
    expect(await shortCollateralInVault()).to.equal(0)
    await updateOracle()
    await vault.sync()

    // We're underneath the collateral minimum, so we shouldn't have opened any positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address, { gasLimit: 1e6 })
    expect(await longCollateralInVault()).to.equal(utils.parseEther('5005'))
    expect(await shortCollateralInVault()).to.equal(utils.parseEther('5005'))
    await updateOracle()

    await vault.sync()
    expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10010'))

    // Now we should have opened positions.
    // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
    expect(await longPosition()).to.equal(smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice))
    expect(await shortPosition()).to.equal(smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice))

    // User 2 should not be able to withdraw; they haven't deposited anything.
    await expect(vault.connect(user2).redeem(1, user2.address)).to.be.revertedWithCustomError(
      vault,
      'BalancedVaultRedemptionLimitExceeded',
    )

    // Transfer all of user's shares to user2
    await vault.connect(user).transfer(user2.address, utils.parseEther('10010'))
    expect(await vault.balanceOf(user.address)).to.equal(0)
    expect(await vault.balanceOf(user2.address)).to.equal(utils.parseEther('10010'))
    // Now User should not be able to withdraw as they have no more shares
    await expect(vault.connect(user).redeem(1, user.address)).to.be.revertedWithCustomError(
      vault,
      'BalancedVaultRedemptionLimitExceeded',
    )

    expect(await vault.maxRedeem(user2.address)).to.equal(utils.parseEther('10010'))
    await vault.connect(user2).redeem(await vault.maxRedeem(user2.address), user2.address)
    await updateOracle()
    await vault.sync()

    // We should have closed all positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    // We should have withdrawn all of our collateral.
    const fundingAmount = BigNumber.from('1526207855124')
    const totalClaimable = utils.parseEther('10010').add(fundingAmount)
    expect(await totalCollateralInVault()).to.equal(totalClaimable)
    expect(await vault.unclaimed(user2.address)).to.equal(totalClaimable)

    await vault.connect(user2).claim(user2.address)
    expect(await totalCollateralInVault()).to.equal(0)
    expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(totalClaimable))
  })

  it('partial transfers using transferFrom', async () => {
    const smallDeposit = utils.parseEther('10')
    await vault.connect(user).deposit(smallDeposit, user.address)
    await updateOracle()
    await vault.sync()

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await updateOracle()
    await vault.sync()

    // Now we should have opened positions.
    // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
    expect(await longPosition()).to.be.equal(
      smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice),
    )
    expect(await shortPosition()).to.equal(smallDeposit.add(largeDeposit).mul(leverage).div(2).div(originalOraclePrice))

    // Setup approval
    const shareBalance = await vault.balanceOf(user.address)
    await vault.connect(user).approve(owner.address, shareBalance.div(2))
    await vault.connect(owner).transferFrom(user.address, user2.address, shareBalance.div(2))
    expect(await vault.balanceOf(user.address)).to.equal(shareBalance.sub(shareBalance.div(2)))
    expect(await vault.balanceOf(user2.address)).to.equal(shareBalance.div(2))

    const maxRedeem = await vault.maxRedeem(user.address)
    await vault.connect(user).redeem(maxRedeem, user.address)
    const maxRedeem2 = await vault.maxRedeem(user2.address)
    await vault.connect(user2).redeem(maxRedeem2, user2.address)
    await updateOracle()
    await vault.sync()

    // We should have closed all positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    // We should have withdrawn all of our collateral.
    await vault.connect(user).claim(user.address)
    await vault.connect(user2).claim(user2.address)

    const fundingAmount = BigNumber.from('1526207855124')
    const totalAssetsIn = utils.parseEther('10010')
    expect(await totalCollateralInVault()).to.equal(0)
    expect(await asset.balanceOf(user.address)).to.equal(
      utils.parseEther('200000').sub(totalAssetsIn.div(2)).add(fundingAmount.div(2)),
    )
    expect(await asset.balanceOf(user2.address)).to.equal(
      utils.parseEther('200000').add(totalAssetsIn.div(2)).add(fundingAmount.div(2)),
    )
  })

  it('maxWithdraw', async () => {
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

    // We shouldn't be able to withdraw more than maxWithdraw.
    await expect(
      vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
    ).to.be.revertedWithCustomError(vault, 'BalancedVaultRedemptionLimitExceeded')

    // But we should be able to withdraw exactly maxWithdraw.
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
    const totalCollateral = await totalCollateralInVault()
    expect(totalCollateral).to.eq(0)
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
    expect(await totalCollateralInVault()).to.be.greaterThan(originalTotalCollateral)
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

  describe('Liquidation', () => {
    it('recovers before being liquidated', async () => {
      await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
      await updateOracle()

      // 1. An oracle update makes the long position liquidatable.
      // We should now longer be able to deposit
      await updateOracle(utils.parseEther('4000'))

      await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
        vault,
        'BalancedVaultDepositLimitExceeded',
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
      // We should now longer be able to deposit
      await updateOracle(utils.parseEther('4000'))

      await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
        vault,
        'BalancedVaultDepositLimitExceeded',
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

      // 4. Liquidate the long position.
      // We should still not be able to deposit.
      await collateral.connect(liquidator).liquidate(vault.address, long.address)
      expect(await vault.maxDeposit(user.address)).to.equal(0)
      await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
        vault,
        'BalancedVaultDepositLimitExceeded',
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
})

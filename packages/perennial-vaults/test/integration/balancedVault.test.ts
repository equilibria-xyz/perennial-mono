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

const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'

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
    return (await longCollateralInVault()).add(await shortCollateralInVault())
  }

  beforeEach(async () => {
    await time.reset(config)
    ;[owner, user, user2, liquidator] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    const controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)
    long = IProduct__factory.connect('0xdB60626FF6cDC9dB07d3625A93d21dDf0f8A688C', owner)
    short = IProduct__factory.connect('0xfeD3E166330341e0305594B8c6e6598F9f4Cbe9B', owner)
    collateral = ICollateral__factory.connect('0x2d264ebdb6632a06a1726193d4d37fef1e5dbdcd', owner)
    leverage = utils.parseEther('1.2')
    maxLeverage = utils.parseEther('1.32')
    fixedFloat = utils.parseEther('10000')

    vault = await new BalancedVault__factory(owner).deploy(
      controller.address,
      long.address,
      short.address,
      leverage,
      maxLeverage,
      fixedFloat,
    )
    await vault.initialize(dsu.address)
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
      address: '0xA59eF0208418559770a48D7ae4f260A28763167B',
    })
    oracle.sync.returns(currentVersion)
    oracle.currentVersion.returns(currentVersion)
    oracle.atVersion.whenCalledWith(currentVersion[0]).returns(currentVersion)
  })

  it('names are correct', async () => {
    expect(await vault.name()).to.equal('Perennial Balanced Vault: Ether')
    expect(await vault.symbol()).to.equal('PBV-ETH')
  })

  it('simple deposits and withdraws', async () => {
    const smallDeposit = utils.parseEther('1000')
    await vault.connect(user).deposit(smallDeposit, user.address)
    expect(await asset.connect(user).balanceOf(user.address)).to.be.greaterThan(0)
    await updateOracle()
    await vault.sync()

    // We're underneath the fixed loat, so we shouldn't have opened any positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await updateOracle()
    await vault.sync()

    // Now we should have opened positions.
    // The positions should be equal to (smallDeposit + largeDeposit - fixedFloat) * leverage / 2 / originalOraclePrice.
    expect(await longPosition()).to.be.equal(
      smallDeposit.add(largeDeposit).sub(fixedFloat).mul(leverage).div(2).div(originalOraclePrice),
    )
    expect(await shortPosition()).to.equal(await longPosition())

    // User 2 should not be able to withdraw; they haven't deposited anything.
    await expect(vault.connect(user2).withdraw(1, user2.address, user2.address)).to.be.revertedWith(
      'ERC4626: withdraw more than max',
    )

    while ((await vault.connect(user).balanceOf(user.address)).gt(0)) {
      const maxWithdraw = await vault.maxWithdraw(user.address)
      await vault.connect(user).withdraw(maxWithdraw, user.address, user.address)
      await updateOracle()
      await vault.sync()
    }

    // We should have closed all positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    // We should have withdrawn all of our collateral.
    expect(await totalCollateralInVault()).to.equal(0)
  })

  it('deposit then immediately withdraw', async () => {
    const originalDsuBalance = await asset.balanceOf(user.address)

    const smallDeposit = utils.parseEther('500')
    await vault.connect(user).deposit(smallDeposit, user.address)
    await vault.connect(user).withdraw(smallDeposit, user.address, user.address)

    await updateOracle()
    await vault.sync()
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    expect(await asset.balanceOf(user.address)).to.equal(originalDsuBalance)

    const largeDeposit = utils.parseEther('20000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await expect(vault.connect(user).withdraw(largeDeposit, user.address, user.address)).to.be.revertedWith(
      'ERC20: transfer amount exceeds balance',
    )
  })

  it('maxWithdraw', async () => {
    const smallDeposit = utils.parseEther('500')
    await vault.connect(user).deposit(smallDeposit, user.address)
    await updateOracle()
    await vault.sync()

    expect(await vault.maxWithdraw(user.address)).to.equal(utils.parseEther('500'))

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await updateOracle()
    await vault.sync()

    const totalDeposits = smallDeposit.add(largeDeposit)
    const position = await longPosition()
    const minCollateral = Big18Math.div(Big18Math.mul(position, originalOraclePrice), maxLeverage).mul(2)

    expect(await vault.maxWithdraw(user.address)).to.equal(totalDeposits.sub(minCollateral))

    // We shouldn't be able to withdraw more than maxWithdraw.
    await expect(
      vault.connect(user).withdraw((await vault.maxWithdraw(user.address)).add(1), user.address, user.address),
    ).to.be.revertedWith('ERC4626: withdraw more than max')

    // But we should be able to withdraw exactly maxWithdraw.
    await vault.connect(user).withdraw(await vault.maxWithdraw(user.address), user.address, user.address)

    // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
    expect(await vault.maxWithdraw(user.address)).to.equal(0)

    // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
    await updateOracle()
    await vault.sync()
    // Our collateral should be less than the fixedFloat and greater than 0.
    const totalCollateral = await totalCollateralInVault()
    expect(totalCollateral).to.be.greaterThan(0)
    expect(totalCollateral).to.be.lessThan(fixedFloat)

    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)
    expect(await vault.maxWithdraw(user.address)).to.equal(totalCollateral)
    await vault.connect(user).withdraw(await vault.maxWithdraw(user.address), user.address, user.address)

    // We should have withdrawn all of our collateral.
    expect(await totalCollateralInVault()).to.equal(0)
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
    expect(await collateralDifference()).to.equal(1)

    await vault.connect(user).deposit(oddDepositAmount, user.address)
    await updateOracle()
    await vault.sync()
    expect(await collateralDifference()).to.equal(0)
  })

  describe('Liquidation', () => {
    it('long liquidated', async () => {
      await vault.connect(user).deposit(utils.parseEther('100000'), user.address)

      await updateOracle()
      await vault.sync()

      // This will make our long position liquidatable.
      await updateOracle(utils.parseEther('6000'))

      // Even if we haven't synced yet, we should not be able to withdraw or deposit.
      expect(await vault.maxWithdraw(user.address)).to.be.equal(0)
      await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
        collateral,
        'CollateralInsufficientCollateralError',
      )

      // The above deposit should have synced the vault, but sync again just for good measure.
      await vault.sync()

      // Again, we should not be able to withdraw but be able to deposit.
      expect(await vault.maxWithdraw(user.address)).to.be.equal(0)
      await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
        collateral,
        'CollateralInsufficientCollateralError',
      )

      await collateral.connect(liquidator).liquidate(vault.address, long.address)

      // Now liquidation has been called, but the liquidation hasn't settled yet.
      expect(await vault.maxWithdraw(user.address)).to.be.equal(0)
      await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
        collateral,
        'CollateralInsufficientCollateralError',
      )

      await updateOracle()

      // The liquidation has settled now. Now we can deposit.
      expect(await vault.maxWithdraw(user.address)).to.be.equal(0)
      await vault.connect(user).deposit(2, user.address)

      await updateOracle()
      await vault.sync()

      // Now our positions have opened back up, so we can withdraw.
      expect(await vault.maxWithdraw(user.address)).to.be.greaterThan(0)
    })
  })

  // TESTS:
  //
  // - Invalid parameters should be rejected by all functions.
})
